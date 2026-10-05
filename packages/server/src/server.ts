import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import {
  coverage, derive, distribution, lintPack, optionsFor, propagate, replay, runRules, validate, weakestLink,
  type Actor, type EaiEvent, type Pack, type State,
} from "../../core/src/index.ts";
import { Store } from "./store.ts";

export interface DeterministicCheck {
  atom: string;
  source: string;
  allowedActorId?: string;
  run(input: { pack: Pack; state: State }): boolean;
}

export interface Config {
  dir: string;
  pack: Pack;
  /** token -> actor. Tokens are secrets and must be at least 32 characters. */
  tokens: Record<string, Actor>;
  checks?: Record<string, DeterministicCheck>;
  maxBodyBytes?: number;
  maxRequestsPerMinute?: number;
  today?: () => string;
}

class HttpError extends Error {
  status: number;
  expose: boolean;
  constructor(status: number, message: string, expose = true) {
    super(message);
    this.status = status;
    this.expose = expose;
  }
}

const ACTOR_KINDS = new Set(["person", "system", "model", "check"]);
const PUBLIC_TYPES = new Set([
  "answer.proposed", "evidence.attached", "confidence.lowered",
  "flag.raised", "flag.dismissed", "status.raised",
]);

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  });
  res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage, maxBytes: number) =>
  new Promise<string>((ok, bad) => {
    let body = "";
    let bytes = 0;
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      bad(err);
    };
    req.on("data", (chunk) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) {
        req.resume();
        return fail(new HttpError(413, "request body too large"));
      }
      body += chunk;
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      ok(body);
    });
    req.on("error", fail);
  });

const requiredString = (value: unknown, field: string, max = 4096): string => {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(422, `${field} must be a non-empty string`);
  if (value.length > max) throw new HttpError(422, `${field} is too long`);
  return value;
};

function validateTokens(tokens: Record<string, Actor>) {
  const entries = Object.entries(tokens);
  if (!entries.length) throw new Error("at least one access token is required");
  for (const [token, actor] of entries) {
    if (token.length < 32) throw new Error("access tokens must be at least 32 characters");
    if (/^(REPLACE_|dev-token-)/.test(token)) throw new Error("placeholder or example access tokens are not allowed");
    if (!actor || !ACTOR_KINDS.has(actor.kind) || typeof actor.id !== "string" || !actor.id.trim()) {
      throw new Error("every token must map to a valid actor");
    }
  }
}

function normalizeProbabilities(value: unknown, allowed: string[]): Record<string, number> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(422, "probabilities must be an object");
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.includes(key)) throw new HttpError(422, `probability key ${key} is not an allowed option`);
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1) {
      throw new HttpError(422, `probability for ${key} must be between 0 and 1`);
    }
    out[key] = raw;
  }
  return out;
}

function canonicalEvidence(raw: any, actor: Actor, eventId: string) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(422, "evidence must be an object");
  const mode = raw.mode;
  if (mode !== "reported" && mode !== "observed") throw new HttpError(422, "evidence mode must be reported or observed");
  if (typeof raw.supports !== "boolean") throw new HttpError(422, "evidence supports must be boolean");
  if (raw.valid_until !== undefined && (typeof raw.valid_until !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.valid_until))) {
    throw new HttpError(422, "valid_until must be an ISO date");
  }
  return {
    id: `${eventId}:evidence`,
    source: requiredString(raw.source, "evidence source", 2048),
    observer: actor,
    mode,
    lineage: `actor:${actor.kind}:${actor.id}`,
    supports: raw.supports,
    ...(raw.valid_until ? { valid_until: raw.valid_until } : {}),
  };
}

export function makeServer(cfg: Config) {
  const problems = lintPack(cfg.pack);
  if (problems.length) throw new Error("pack is invalid:\n" + problems.join("\n"));
  validateTokens(cfg.tokens);

  const atoms = new Map(cfg.pack.atoms.map((a) => [a.id, a]));
  for (const [id, check] of Object.entries(cfg.checks ?? {})) {
    if (!id.trim() || !atoms.has(check.atom) || typeof check.run !== "function" || !check.source?.trim()) {
      throw new Error(`invalid deterministic check configuration: ${id}`);
    }
  }

  const store = new Store(cfg.dir);
  const initialIntegrity = store.verify();
  if (!initialIntegrity.ok) {
    throw new Error(`event log integrity check failed at ${initialIntegrity.log ?? "events"} seq ${initialIntegrity.badAt ?? "?"}`);
  }

  const today = cfg.today ?? (() => new Date().toISOString().slice(0, 10));
  const validFor = Object.fromEntries(cfg.pack.atoms.filter((a) => a.valid_for_days).map((a) => [a.id, a.valid_for_days!]));
  const maxBodyBytes = cfg.maxBodyBytes ?? 64 * 1024;
  const maxRequestsPerMinute = cfg.maxRequestsPerMinute ?? 240;
  const rate = new Map<string, { started: number; count: number }>();

  let snapshotDate = today();
  let snapshot = replay(store.events, snapshotDate, validFor);
  const refreshSnapshot = () => {
    snapshotDate = today();
    snapshot = replay(store.events, snapshotDate, validFor);
  };
  const currentSnapshot = () => {
    if (today() !== snapshotDate) refreshSnapshot();
    return snapshot;
  };
  const requireWritableIntegrity = () => {
    const integrity = store.verify();
    if (!integrity.ok) throw new HttpError(503, "event log integrity check failed");
  };

  const view = () => {
    const r = currentSnapshot();
    const ruleFlags = runRules(cfg.pack.rules ?? [], r.state, r.derived);
    const actorFlags = Object.entries(r.state).flatMap(([atom, atomState]) =>
      atomState.flags
        .filter((flag) => !flag.dismissed)
        .map((flag) => ({ rule: flag.id, flag: "info", message: flag.message, atom, by: flag.by })),
    );
    return {
      r,
      body: {
        asOf: snapshotDate,
        pack: { id: cfg.pack.pack, version: cfg.pack.version, domain: cfg.pack.domain ?? null },
        atoms: Object.fromEntries(cfg.pack.atoms.map((a) => [a.id, {
          question: a.question,
          type: a.type,
          dependsOn: a.depends_on ?? [],
          impact: a.impact ?? null,
          validForDays: a.valid_for_days ?? null,
          value: r.state[a.id]?.value ?? null,
          ...derive(r.state[a.id], snapshotDate, { validForDays: validFor[a.id] }),
        }])),
        clusters: cfg.pack.clusters,
        distribution: distribution(cfg.pack, r.derived),
        flags: [...ruleFlags, ...actorFlags],
        shaky: propagate(cfg.pack, r.derived),
        coverage: coverage(cfg.pack, r.state, r.derived),
        checksum: r.checksum,
        rejectedAttempts: store.rejections.length,
        note: "Nothing flagged means not detected, not safe.",
      },
    };
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
          "referrer-policy": "no-referrer",
          "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        });
        return res.end(readFileSync(new URL("../../client/index.html", import.meta.url)));
      }

      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const actor = Object.prototype.hasOwnProperty.call(cfg.tokens, token) ? cfg.tokens[token] : undefined;
      if (!actor) return json(res, 401, { error: "missing or unknown token" });

      const nowMs = Date.now();
      const bucket = rate.get(token);
      if (!bucket || nowMs - bucket.started >= 60_000) rate.set(token, { started: nowMs, count: 1 });
      else if (++bucket.count > maxRequestsPerMinute) return json(res, 429, { error: "rate limit exceeded" });

      if (req.method === "POST" && url.pathname === "/events") {
        requireWritableIntegrity();
        let raw: any;
        try {
          raw = JSON.parse((await readBody(req, maxBodyBytes)) || "{}");
        } catch (e) {
          if (e instanceof HttpError) throw e;
          throw new HttpError(400, "invalid JSON");
        }

        const attempted = { ...raw, actor, at: today() };
        const reject = (reason: string) => {
          store.recordRejection({ at: today(), actor, attempted, reason });
          return json(res, 422, { rejected: true, reason });
        };

        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return reject("event must be an object");
        if (!PUBLIC_TYPES.has(raw.type)) {
          if (raw.type === "check.passed") return reject("check.passed is server-generated only");
          return reject("unknown event type");
        }

        const atomDef = atoms.get(raw.atom);
        if (!atomDef) return reject(`unknown atom ${raw.atom}`);
        const eventId = `ev${store.next()}`;
        let event: EaiEvent;

        if (raw.type === "answer.proposed") {
          const value = requiredString(raw.value, "answer value", 256);
          const allowed = optionsFor(atomDef);
          if (!allowed.includes(value)) return reject(`value must be one of ${allowed.join(", ")}`);
          const probabilities = normalizeProbabilities(raw.probabilities, allowed);
          event = { id: eventId, at: today(), actor, type: "answer.proposed", atom: raw.atom, value, ...(probabilities ? { probabilities } : {}) };
        } else if (raw.type === "evidence.attached") {
          try {
            event = { id: eventId, at: today(), actor, type: "evidence.attached", atom: raw.atom, evidence: canonicalEvidence(raw.evidence, actor, eventId) };
          } catch (e) {
            if (e instanceof HttpError) return reject(e.message);
            throw e;
          }
        } else if (raw.type === "confidence.lowered") {
          event = { id: eventId, at: today(), actor, type: "confidence.lowered", atom: raw.atom, reason: requiredString(raw.reason, "reason") };
        } else if (raw.type === "flag.raised") {
          event = { id: eventId, at: today(), actor, type: "flag.raised", atom: raw.atom, message: requiredString(raw.message, "flag message") };
        } else if (raw.type === "flag.dismissed") {
          event = {
            id: eventId, at: today(), actor, type: "flag.dismissed", atom: raw.atom,
            flag: requiredString(raw.flag, "flag id", 256), reason: requiredString(raw.reason, "reason"),
          };
        } else {
          event = { id: eventId, at: today(), actor, type: "status.raised", atom: raw.atom, to: raw.to };
        }

        const v = validate(event, currentSnapshot().state);
        if (!v.ok) return reject(v.reason);
        const line = store.append(event);
        refreshSnapshot();
        return json(res, 201, { seq: line.seq, hash: line.hash });
      }

      if (req.method === "POST" && url.pathname.startsWith("/checks/")) {
        requireWritableIntegrity();
        if (actor.kind !== "check") return json(res, 403, { error: "check runner token required" });
        const id = decodeURIComponent(url.pathname.slice("/checks/".length));
        const check = cfg.checks?.[id];
        if (!check) return json(res, 404, { error: "unknown deterministic check" });
        if (check.allowedActorId && check.allowedActorId !== actor.id) return json(res, 403, { error: "check runner is not allowed for this check" });

        const r = currentSnapshot();
        let passed = false;
        try {
          passed = check.run({ pack: cfg.pack, state: structuredClone(r.state) }) === true;
        } catch {
          throw new HttpError(500, "deterministic check failed", false);
        }
        if (!passed) return json(res, 422, { passed: false });

        const eventId = `ev${store.next()}`;
        const event: EaiEvent = {
          id: eventId,
          at: today(),
          actor,
          type: "check.passed",
          atom: check.atom,
          evidence: {
            id: `${eventId}:evidence`,
            source: check.source,
            observer: actor,
            mode: "observed",
            lineage: `check:${id}`,
            supports: true,
            deterministic: true,
          },
        };
        const v = validate(event, r.state);
        if (!v.ok) throw new HttpError(500, v.reason, false);
        const line = store.append(event);
        refreshSnapshot();
        return json(res, 201, { passed: true, seq: line.seq, hash: line.hash });
      }

      if (req.method === "GET" && url.pathname === "/state") return json(res, 200, view().body);
      if (req.method === "GET" && url.pathname.startsWith("/explain/")) {
        const id = decodeURIComponent(url.pathname.slice(9));
        const { r } = view();
        if (!atoms.has(id)) return json(res, 404, { error: "unknown atom" });
        return json(res, 200, {
          atom: id,
          ...derive(r.state[id], snapshotDate, { validForDays: validFor[id] }),
          evidence: r.state[id]?.evidence ?? [],
          flags: r.state[id]?.flags ?? [],
        });
      }
      if (req.method === "GET" && url.pathname === "/weakest") {
        const goals = (url.searchParams.get("goal") ?? "").split(",").filter(Boolean);
        return json(res, 200, weakestLink(cfg.pack, currentSnapshot().derived, goals));
      }
      if (req.method === "GET" && url.pathname === "/log/verify") return json(res, 200, store.verify());
      return json(res, 404, { error: "not found" });
    } catch (e: any) {
      if (e instanceof HttpError) return json(res, e.status, { error: e.expose ? e.message : "internal server error" });
      return json(res, 500, { error: "internal server error" });
    }
  });
  return { server, store };
}

// Run directly: EAI_TOKENS=./tokens.json EAI_DIR=./data node packages/server/src/server.ts
if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  const tokenFile = process.env.EAI_TOKENS;
  if (!tokenFile) throw new Error("EAI_TOKENS is required; the server never falls back to example credentials");
  const { server } = makeServer({
    dir: process.env.EAI_DIR ?? "./data",
    pack: JSON.parse(readFileSync(process.env.EAI_PACK ?? "packs/sow-demo/pack.json", "utf8")),
    tokens: JSON.parse(readFileSync(tokenFile, "utf8")),
  });
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.EAI_HOST ?? "127.0.0.1";
  server.listen(port, host, () => console.log(`EAI server on http://${host}:${port}`));
}

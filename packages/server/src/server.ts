import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  coverage, derive, distribution, lintPack, optionsFor, propagate, replay, runRules, validate, weakestLink,
  type Actor, type EaiEvent, type Pack, type State,
} from "../../core/src/index.ts";
import { Store } from "./store.ts";
import { canAudit, canRead, canRunCheck, canWrite, validatePrincipals, type Principal } from "./authz.ts";
import { SignedFileAnchorWitness, type AnchorWitness } from "./witness.ts";

export interface DeterministicCheck {
  atom: string;
  reads: string[];
  source: string;
  allowedActorId: string;
  run(input: { pack: Pack; state: State }): boolean;
}

export interface Config {
  dir: string;
  pack: Pack;
  /** token -> principal. Access is default-deny and explicit per atom/check. */
  tokens: Record<string, Principal>;
  witness: AnchorWitness;
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

const ruleAtoms = (condition: any): string[] => {
  if (!condition || typeof condition !== "object") return [];
  if (Array.isArray(condition.all)) return condition.all.flatMap(ruleAtoms);
  if (Array.isArray(condition.any)) return condition.any.flatMap(ruleAtoms);
  if (condition.not) return ruleAtoms(condition.not);
  return typeof condition.atom === "string" ? [condition.atom] : [];
};

const visibleRules = (rules: any[] | undefined, visible: Set<string>) =>
  (rules ?? []).filter((rule) => ruleAtoms(rule.when).every((atom) => visible.has(atom)));

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
  const atoms = new Map(cfg.pack.atoms.map((a) => [a.id, a]));
  validatePrincipals(cfg.tokens, cfg.pack, Object.keys(cfg.checks ?? {}), ACTOR_KINDS);

  for (const [id, check] of Object.entries(cfg.checks ?? {})) {
    if (
      !id.trim() ||
      !atoms.has(check.atom) ||
      !Array.isArray(check.reads) ||
      !check.reads.length ||
      !check.reads.includes(check.atom) ||
      check.reads.some((atom) => !atoms.has(atom)) ||
      typeof check.run !== "function" ||
      !check.source?.trim() ||
      !check.allowedActorId?.trim()
    ) {
      throw new Error(`invalid deterministic check configuration: ${id}`);
    }
  }

  const store = new Store(cfg.dir, cfg.witness);
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

  const scoped = (principal: Principal) => {
    const r = currentSnapshot();
    const visible = new Set(cfg.pack.atoms.filter((a) => canRead(principal, a.id)).map((a) => a.id));
    const visibleAtoms = cfg.pack.atoms
      .filter((a) => visible.has(a.id))
      .map((a) => ({ ...a, depends_on: (a.depends_on ?? []).filter((id) => visible.has(id)) }));
    const visiblePack: Pack = {
      ...cfg.pack,
      atoms: visibleAtoms,
      clusters: cfg.pack.clusters
        .map((cluster) => ({ ...cluster, atoms: cluster.atoms.filter((id) => visible.has(id)) }))
        .filter((cluster) => cluster.atoms.length > 0),
      rules: visibleRules(cfg.pack.rules, visible),
    };
    const visibleState = Object.fromEntries(Object.entries(r.state).filter(([id]) => visible.has(id)));
    const visibleDerived = Object.fromEntries(Object.entries(r.derived).filter(([id]) => visible.has(id)));
    const ruleFlags = runRules(visiblePack.rules ?? [], visibleState, visibleDerived);
    const actorFlags = Object.entries(visibleState).flatMap(([atom, atomState]) =>
      atomState.flags
        .filter((flag) => !flag.dismissed)
        .map((flag) => ({ rule: flag.id, flag: "info", message: flag.message, atom, by: flag.by })),
    );
    const checksum = createHash("sha256")
      .update(JSON.stringify(Object.entries(visibleDerived).map(([id, d]) => [id, d.status]).sort()))
      .digest("hex");

    return {
      r,
      visible,
      visiblePack,
      visibleState,
      visibleDerived,
      body: {
        asOf: snapshotDate,
        pack: { id: cfg.pack.pack, version: cfg.pack.version, domain: cfg.pack.domain ?? null },
        atoms: Object.fromEntries(visibleAtoms.map((a) => [a.id, {
          question: a.question,
          type: a.type,
          dependsOn: a.depends_on ?? [],
          impact: a.impact ?? null,
          validForDays: a.valid_for_days ?? null,
          value: visibleState[a.id]?.value ?? null,
          ...derive(visibleState[a.id], snapshotDate, { validForDays: validFor[a.id] }),
        }])),
        clusters: visiblePack.clusters,
        distribution: distribution(visiblePack, visibleDerived),
        flags: [...ruleFlags, ...actorFlags],
        shaky: propagate(visiblePack, visibleDerived),
        coverage: coverage(visiblePack, visibleState, visibleDerived),
        checksum,
        ...(canAudit(principal) ? { rejectedAttempts: store.rejections.length } : {}),
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
      const principal = Object.prototype.hasOwnProperty.call(cfg.tokens, token) ? cfg.tokens[token] : undefined;
      if (!principal) return json(res, 401, { error: "missing or unknown token" });
      const actor = principal.actor;

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

        if (!canWrite(principal, raw.atom)) {
          store.recordRejection({ at: today(), actor, attempted, reason: "write access denied" });
          return json(res, 403, { error: "write access denied" });
        }
        const atomDef = atoms.get(raw.atom);
        if (!atomDef) return reject(`unknown atom ${raw.atom}`);
        const eventId = `ev${store.next()}`;
        let event: EaiEvent;

        try {
          if (raw.type === "answer.proposed") {
            const value = requiredString(raw.value, "answer value", 256);
            const allowed = optionsFor(atomDef);
            if (!allowed.includes(value)) return reject(`value must be one of ${allowed.join(", ")}`);
            const probabilities = normalizeProbabilities(raw.probabilities, allowed);
            event = { id: eventId, at: today(), actor, type: "answer.proposed", atom: raw.atom, value, ...(probabilities ? { probabilities } : {}) };
          } else if (raw.type === "evidence.attached") {
            event = { id: eventId, at: today(), actor, type: "evidence.attached", atom: raw.atom, evidence: canonicalEvidence(raw.evidence, actor, eventId) };
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
        } catch (e) {
          if (e instanceof HttpError) return reject(e.message);
          throw e;
        }

        const v = validate(event, currentSnapshot().state);
        if (!v.ok) return reject(v.reason);
        const line = store.append(event);
        refreshSnapshot();
        return json(res, 201, { seq: line.seq, hash: line.hash });
      }

      if (req.method === "POST" && url.pathname.startsWith("/checks/")) {
        requireWritableIntegrity();
        await readBody(req, maxBodyBytes);
        if (actor.kind !== "check") return json(res, 403, { error: "check runner token required" });
        const id = decodeURIComponent(url.pathname.slice("/checks/".length));
        if (!canRunCheck(principal, id)) return json(res, 403, { error: "check access denied" });
        const check = cfg.checks?.[id];
        if (!check) return json(res, 404, { error: "unknown deterministic check" });
        if (check.reads.some((atom) => !canRead(principal, atom))) {
          return json(res, 403, { error: "check input read access denied" });
        }
        if (check.allowedActorId !== actor.id) return json(res, 403, { error: "check runner is not allowed for this check" });

        const r = currentSnapshot();
        const checkVisible = new Set(check.reads);
        const checkPack: Pack = {
          ...cfg.pack,
          atoms: cfg.pack.atoms
            .filter((atom) => checkVisible.has(atom.id))
            .map((atom) => ({ ...atom, depends_on: (atom.depends_on ?? []).filter((dep) => checkVisible.has(dep)) })),
          clusters: cfg.pack.clusters
            .map((cluster) => ({ ...cluster, atoms: cluster.atoms.filter((atom) => checkVisible.has(atom)) }))
            .filter((cluster) => cluster.atoms.length > 0),
          rules: visibleRules(cfg.pack.rules, checkVisible),
        };
        const checkState = Object.fromEntries(Object.entries(r.state).filter(([atom]) => checkVisible.has(atom)));
        let passed = false;
        try {
          passed = check.run({ pack: checkPack, state: structuredClone(checkState) }) === true;
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

      if (req.method === "GET" && url.pathname === "/state") return json(res, 200, scoped(principal).body);
      if (req.method === "GET" && url.pathname.startsWith("/explain/")) {
        const id = decodeURIComponent(url.pathname.slice(9));
        const { r, visible } = scoped(principal);
        if (!visible.has(id)) return json(res, 404, { error: "unknown or unavailable atom" });
        return json(res, 200, {
          atom: id,
          ...derive(r.state[id], snapshotDate, { validForDays: validFor[id] }),
          evidence: r.state[id]?.evidence ?? [],
          flags: r.state[id]?.flags ?? [],
        });
      }
      if (req.method === "GET" && url.pathname === "/weakest") {
        const goals = (url.searchParams.get("goal") ?? "").split(",").filter(Boolean);
        const { visiblePack, visibleDerived, visible } = scoped(principal);
        if (goals.some((id) => !visible.has(id))) return json(res, 404, { error: "unknown or unavailable atom" });
        return json(res, 200, weakestLink(visiblePack, visibleDerived, goals));
      }
      if (req.method === "GET" && url.pathname === "/log/verify") {
        if (!canAudit(principal)) return json(res, 403, { error: "audit access required" });
        return json(res, 200, store.verify());
      }
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
  const witnessDir = process.env.EAI_WITNESS_DIR;
  const privateKeyFile = process.env.EAI_WITNESS_PRIVATE_KEY;
  const publicKeyFile = process.env.EAI_WITNESS_PUBLIC_KEY;
  if (!witnessDir || !privateKeyFile || !publicKeyFile) {
    throw new Error("EAI_WITNESS_DIR, EAI_WITNESS_PRIVATE_KEY and EAI_WITNESS_PUBLIC_KEY are required");
  }
  const dataDir = resolve(process.env.EAI_DIR ?? "./data");
  const resolvedWitnessDir = resolve(witnessDir);
  const witnessRelativeToData = relative(dataDir, resolvedWitnessDir);
  if (witnessRelativeToData === "" || (!witnessRelativeToData.startsWith("..") && !isAbsolute(witnessRelativeToData))) {
    throw new Error("EAI_WITNESS_DIR must be outside EAI_DIR");
  }
  const witness = new SignedFileAnchorWitness(
    resolvedWitnessDir,
    readFileSync(privateKeyFile, "utf8"),
    readFileSync(publicKeyFile, "utf8"),
  );
  const { server } = makeServer({
    dir: dataDir,
    pack: JSON.parse(readFileSync(process.env.EAI_PACK ?? "packs/sow-demo/pack.json", "utf8")),
    tokens: JSON.parse(readFileSync(tokenFile, "utf8")),
    witness,
  });
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.EAI_HOST ?? "127.0.0.1";
  server.listen(port, host, () => console.log(`EAI server on http://${host}:${port}`));
}

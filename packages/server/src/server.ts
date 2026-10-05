import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import {
  apply, coverage, derive, distribution, lintPack, optionsFor, propagate, replay, runRules, validate, weakestLink,
  type Actor, type EaiEvent, type Pack,
} from "../../core/src/index.ts";
import { Store } from "./store.ts";

export interface Config {
  dir: string;
  pack: Pack;
  /** token -> actor. The actor kind comes from the token, never from the request body. */
  tokens: Record<string, Actor>;
  today?: () => string;
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const readBody = (req: IncomingMessage) =>
  new Promise<string>((ok, bad) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => ok(b)); req.on("error", bad); });

export function makeServer(cfg: Config) {
  const problems = lintPack(cfg.pack);
  if (problems.length) throw new Error("pack is invalid:\n" + problems.join("\n"));
  const store = new Store(cfg.dir);
  const today = cfg.today ?? (() => new Date().toISOString().slice(0, 10));
  const validFor = Object.fromEntries(cfg.pack.atoms.filter((a) => a.valid_for_days).map((a) => [a.id, a.valid_for_days!]));
  const atoms = new Map(cfg.pack.atoms.map((a) => [a.id, a]));

  const view = () => {
    const r = replay(store.events, today(), validFor);
    return {
      r,
      body: {
        asOf: today(),
        pack: { id: cfg.pack.pack, version: cfg.pack.version, domain: cfg.pack.domain ?? null },
        atoms: Object.fromEntries(cfg.pack.atoms.map((a) => [a.id, {
          question: a.question,
          type: a.type,
          dependsOn: a.depends_on ?? [],
          impact: a.impact ?? null,
          validForDays: a.valid_for_days ?? null,
          value: r.state[a.id]?.value ?? null,
          ...derive(r.state[a.id], today(), { validForDays: validFor[a.id] }),
        }])),
        clusters: cfg.pack.clusters,
        distribution: distribution(cfg.pack, r.derived),
        flags: runRules(cfg.pack.rules ?? [], r.state, r.derived),
        shaky: propagate(cfg.pack, r.derived),
        coverage: coverage(cfg.pack, r.state, r.derived),
        checksum: r.checksum,
        note: "Nothing flagged means not detected, not safe.",
      },
    };
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(readFileSync(new URL("../../client/index.html", import.meta.url)));
      }
      const actor = cfg.tokens[(req.headers.authorization ?? "").replace(/^Bearer /, "")];
      if (!actor) return json(res, 401, { error: "missing or unknown token" });

      if (req.method === "POST" && url.pathname === "/events") {
        const raw = JSON.parse((await readBody(req)) || "{}");
        const atomDef = atoms.get(raw.atom);
        if (!atomDef) return json(res, 422, { rejected: true, reason: `unknown atom ${raw.atom}` });
        // Identity, id and time are set by the server. Whatever the client sent for them is ignored.
        const event = { ...raw, actor, id: `ev${store.next()}`, at: today() } as EaiEvent;
        if (event.type === "answer.proposed" && !optionsFor(atomDef).includes(event.value)) {
          return json(res, 422, { rejected: true, reason: `value must be one of ${optionsFor(atomDef).join(", ")}` });
        }
        const { r } = view();
        const v = validate(event, r.state);
        if (!v.ok) {
          // Rejections are part of the record: attempts to bypass the rules must be visible.
          return json(res, 422, { rejected: true, reason: v.reason });
        }
        const line = store.append(event);
        return json(res, 201, { seq: line.seq, hash: line.hash });
      }
      if (req.method === "GET" && url.pathname === "/state") return json(res, 200, view().body);
      if (req.method === "GET" && url.pathname.startsWith("/explain/")) {
        const id = decodeURIComponent(url.pathname.slice(9));
        const { r } = view();
        if (!atoms.has(id)) return json(res, 404, { error: "unknown atom" });
        return json(res, 200, { atom: id, ...derive(r.state[id], today(), { validForDays: validFor[id] }), evidence: r.state[id]?.evidence ?? [] });
      }
      if (req.method === "GET" && url.pathname === "/weakest") {
        const goals = (url.searchParams.get("goal") ?? "").split(",").filter(Boolean);
        return json(res, 200, weakestLink(cfg.pack, view().r.derived, goals));
      }
      if (req.method === "GET" && url.pathname === "/log/verify") return json(res, 200, store.verify());
      return json(res, 404, { error: "not found" });
    } catch (e: any) {
      return json(res, 400, { error: String(e?.message ?? e) });
    }
  });
  return { server, store };
}

// Run directly: EAI_DIR=./data EAI_PACK=packs/sow-demo/pack.json EAI_TOKENS=./tokens.json node packages/server/src/server.ts
if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  const { server } = makeServer({
    dir: process.env.EAI_DIR ?? "./data",
    pack: JSON.parse(readFileSync(process.env.EAI_PACK ?? "packs/sow-demo/pack.json", "utf8")),
    tokens: JSON.parse(readFileSync(process.env.EAI_TOKENS ?? "tokens.example.json", "utf8")),
  });
  const port = Number(process.env.PORT ?? 8787);
  server.listen(port, () => console.log(`EAI server on http://localhost:${port}`));
}

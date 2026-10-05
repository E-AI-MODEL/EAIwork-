import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { makeServer } from "../packages/server/src/server.ts";
import { ask, mockProvider } from "../packages/gateway/src/gateway.ts";

const pack = JSON.parse(readFileSync(new URL("../packs/sow-demo/pack.json", import.meta.url), "utf8"));
const PERSON_TOKEN = "p".repeat(40);
const MODEL_TOKEN = "m".repeat(40);
const CHECK_TOKEN = "c".repeat(40);
const tokens = {
  [PERSON_TOKEN]: { kind: "person", id: "person:jan" } as const,
  [MODEL_TOKEN]: { kind: "model", id: "model:demo" } as const,
  [CHECK_TOKEN]: { kind: "check", id: "check:calc" } as const,
};
const checks = {
  "budget-approved": {
    atom: "a.fin.017",
    source: "server-side deterministic budget check",
    allowedActorId: "check:calc",
    run: ({ state }: any) => state["a.fin.017"]?.value === "yes",
  },
};

const dir = mkdtempSync(join(tmpdir(), "eai-"));
const { server, store } = makeServer({
  dir, pack, today: () => "2026-10-05", tokens, checks,
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const post = (token: string, body: unknown, path = "/events") =>
  fetch(base + path, { method: "POST", headers: { authorization: "Bearer " + token }, body: JSON.stringify(body) });
const get = async (token: string, path: string) =>
  (await fetch(base + path, { headers: { authorization: "Bearer " + token } })).json() as any;

test("weak or placeholder tokens are rejected at startup", () => {
  assert.throws(
    () => makeServer({ dir: mkdtempSync(join(tmpdir(), "eai-weak-")), pack, tokens: { short: { kind: "person", id: "person:x" } } }),
    /at least 32 characters/,
  );
  assert.throws(
    () => makeServer({ dir: mkdtempSync(join(tmpdir(), "eai-placeholder-")), pack, tokens: { REPLACE_WITH_RANDOM_TOKEN_1234567890: { kind: "person", id: "person:x" } } }),
    /placeholder or example/,
  );
});

test("no token or inherited object property: 401", async () => {
  assert.equal((await fetch(base + "/state")).status, 401);
  assert.equal((await fetch(base + "/state", { headers: { authorization: "Bearer constructor" } })).status, 401);
});

test("a model proposes; its attempt to raise status is rejected", async () => {
  assert.equal((await post(MODEL_TOKEN, { type: "answer.proposed", atom: "a.fin.017", value: "yes" })).status, 201);
  const raise = await post(MODEL_TOKEN, { type: "status.raised", atom: "a.fin.017", to: "proven" });
  assert.equal(raise.status, 422);
  assert.match((await raise.json() as any).reason, /model cannot raise status/);
  assert.match(store.rejections.at(-1)!.reason, /model cannot raise status/);
  assert.equal((await get(PERSON_TOKEN, "/state")).atoms["a.fin.017"].status, "assumption");
});

test("a model cannot attach evidence or impersonate a person", async () => {
  const spoof = await post(MODEL_TOKEN, {
    type: "evidence.attached", atom: "a.fin.017",
    evidence: { source: "s", observer: { kind: "person", id: "person:jan" }, mode: "observed", lineage: "fake", supports: true },
  });
  assert.equal(spoof.status, 422);
  assert.match((await spoof.json() as any).reason, /model cannot emit evidence.attached/);
  assert.equal((await get(PERSON_TOKEN, "/state")).atoms["a.fin.017"].status, "assumption");
});

test("a person attaches evidence: claim; client-set event identity and time are ignored", async () => {
  const r = await post(PERSON_TOKEN, {
    type: "evidence.attached", atom: "a.fin.017", at: "1999-01-01", id: "evil",
    evidence: { id: "evil-evidence", source: "mail", observer: { kind: "model", id: "model:x" }, mode: "reported", lineage: "forged", supports: true },
  });
  assert.equal(r.status, 201);
  assert.equal(store.events.at(-1)!.at, "2026-10-05");
  assert.notEqual(store.events.at(-1)!.id, "evil");
  const s = await get(PERSON_TOKEN, "/state");
  assert.equal(s.atoms["a.fin.017"].status, "claim");
  const ex = await get(PERSON_TOKEN, "/explain/a.fin.017");
  assert.equal(ex.evidence.at(-1).observer.id, "person:jan");
  assert.equal(ex.evidence.at(-1).lineage, "actor:person:person:jan");
  assert.notEqual(ex.evidence.at(-1).id, "evil-evidence");
});

test("one person cannot forge independent origins with different lineage strings", async () => {
  for (const lineage of ["origin:one", "origin:two"]) {
    const r = await post(PERSON_TOKEN, {
      type: "evidence.attached", atom: "a.fin.017",
      evidence: { source: lineage, mode: "observed", lineage, supports: true },
    });
    assert.equal(r.status, 201);
  }
  const s = await get(PERSON_TOKEN, "/state");
  assert.equal(s.atoms["a.fin.017"].status, "observed");
  const ex = await get(PERSON_TOKEN, "/explain/a.fin.017");
  assert.deepEqual([...new Set(ex.evidence.map((e: any) => e.lineage))], ["actor:person:person:jan"]);
});

test("public clients cannot submit check.passed", async () => {
  const r = await post(CHECK_TOKEN, {
    type: "check.passed", atom: "a.fin.017",
    evidence: { source: "fake", observer: { kind: "check", id: "check:calc" }, mode: "observed", lineage: "forged", supports: true, deterministic: true },
  });
  assert.equal(r.status, 422);
  assert.match((await r.json() as any).reason, /server-generated only/);
  assert.equal((await get(PERSON_TOKEN, "/state")).atoms["a.fin.017"].status, "observed");
});

test("only a registered server-side deterministic check can create proven status", async () => {
  assert.equal((await post(PERSON_TOKEN, {}, "/checks/budget-approved")).status, 403);
  const r = await post(CHECK_TOKEN, {}, "/checks/budget-approved");
  assert.equal(r.status, 201);
  assert.equal((await r.json() as any).passed, true);
  const s = await get(PERSON_TOKEN, "/state");
  assert.equal(s.atoms["a.fin.017"].status, "proven");
  const ex = await get(PERSON_TOKEN, "/explain/a.fin.017");
  assert.ok(ex.evidence.some((e: any) => e.lineage === "check:budget-approved" && e.deterministic === true));
});

test("values must be allowed options; unknown atoms and event types are rejected", async () => {
  assert.equal((await post(PERSON_TOKEN, { type: "answer.proposed", atom: "a.plan.003", value: "maybe" })).status, 422);
  assert.equal((await post(PERSON_TOKEN, { type: "answer.proposed", atom: "a.nope", value: "yes" })).status, 422);
  const unknown = await post(PERSON_TOKEN, { type: "future.magic", atom: "a.plan.003" });
  assert.equal(unknown.status, 422);
  assert.match((await unknown.json() as any).reason, /unknown event type/);
});

test("oversized request bodies are rejected before event processing", async () => {
  const huge = "x".repeat(70 * 1024);
  const r = await post(MODEL_TOKEN, { type: "flag.raised", atom: "a.fin.017", message: huge });
  assert.equal(r.status, 413);
});

test("actor-raised flags are visible and a person can dismiss them", async () => {
  assert.equal((await post(PERSON_TOKEN, { type: "answer.proposed", atom: "a.fin.016", value: "yes" })).status, 201);
  assert.equal((await post(MODEL_TOKEN, { type: "flag.raised", atom: "a.fin.016", message: "model concern" })).status, 201);
  const state = await get(PERSON_TOKEN, "/state");
  const flag = state.flags.find((x: any) => x.message === "model concern");
  assert.ok(flag);
  const explanation = await get(PERSON_TOKEN, "/explain/a.fin.016");
  assert.ok(explanation.flags.some((x: any) => x.message === "model concern" && !x.dismissed));
  assert.equal((await post(PERSON_TOKEN, { type: "flag.dismissed", atom: "a.fin.016", flag: flag.rule, reason: "reviewed" })).status, 201);
  const after = await get(PERSON_TOKEN, "/state");
  assert.ok(!after.flags.some((x: any) => x.message === "model concern"));
});

test("gateway: provider output is clamped to fixed options and routed", async () => {
  const atom = pack.atoms.find((a: any) => a.id === "a.plan.003");
  const res = await ask(
    mockProvider("model:demo", { "a.plan.003": { yes: 0.9, no: 0.05, banana: 5 } }), atom,
    { at: "2026-10-05", eventId: "g1" },
  );
  assert.equal(res.event.type, "answer.proposed");
  assert.equal((res.event as any).value, "yes");
  assert.ok(!("banana" in res.probabilities));
  assert.equal(res.route, "accept-as-assumption");
});

test("log hash chain verifies, detects tampering, and makeServer fails closed", async () => {
  assert.deepEqual(await get(PERSON_TOKEN, "/log/verify"), { ok: true });
  const file = join(dir, "events.jsonl");
  const original = readFileSync(file, "utf8");
  const originalLines = original.split("\n").filter(Boolean);

  const tampered = [...originalLines];
  const first = JSON.parse(tampered[0]); first.event.value = "no"; tampered[0] = JSON.stringify(first);
  writeFileSync(file, tampered.join("\n") + "\n");
  assert.equal(store.verify().ok, false);
  const { Store } = await import("../packages/server/src/store.ts");
  assert.equal(new Store(dir).verify().ok, false);
  assert.throws(() => makeServer({ dir, pack, tokens, checks }), /integrity check failed/);

  writeFileSync(file, original);
  assert.equal(new Store(dir).verify().ok, true);

  writeFileSync(file, originalLines.slice(0, -1).join("\n") + "\n");
  assert.equal(new Store(dir).verify().ok, false);
  assert.throws(() => makeServer({ dir, pack, tokens, checks }), /integrity check failed/);
  writeFileSync(file, original);
});

test("state exposes pack and dependency metadata for the workbench", async () => {
  const s = await get(PERSON_TOKEN, "/state");
  assert.deepEqual(s.pack, { id: "sow-demo", version: "0.1.0", domain: "school onboarding trajectory (invented demo data)" });
  assert.deepEqual(s.atoms["a.fin.017"].dependsOn, ["a.fin.016"]);
  assert.equal(s.atoms["a.fin.017"].type, "yesno");
  assert.equal(s.atoms["a.fin.017"].validForDays, 90);
});

test("served workbench includes security headers and the evidence-first interface", async () => {
  const response = await fetch(base + "/");
  const html = await response.text();
  assert.match(html, /EAI work/);
  assert.match(html, /Work graph/);
  assert.match(html, /Evidence inspector/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
});

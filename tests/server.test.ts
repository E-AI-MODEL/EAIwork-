import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { makeServer } from "../packages/server/src/server.ts";
import { ask, mockProvider } from "../packages/gateway/src/gateway.ts";

const pack = JSON.parse(readFileSync(new URL("../packs/sow-demo/pack.json", import.meta.url), "utf8"));
const dir = mkdtempSync(join(tmpdir(), "eai-"));
const { server, store } = makeServer({
  dir, pack, today: () => "2026-10-05",
  tokens: {
    tj: { kind: "person", id: "person:jan" },
    tm: { kind: "model", id: "model:demo" },
    tc: { kind: "check", id: "check:calc" },
  },
});
await new Promise<void>((r) => server.listen(0, r));
const base = `http://localhost:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const post = (token: string, body: unknown) =>
  fetch(base + "/events", { method: "POST", headers: { authorization: "Bearer " + token }, body: JSON.stringify(body) });
const get = async (token: string, path: string) => (await fetch(base + path, { headers: { authorization: "Bearer " + token } })).json() as any;

test("no token or inherited object property: 401", async () => {
  assert.equal((await fetch(base + "/state")).status, 401);
  assert.equal((await fetch(base + "/state", { headers: { authorization: "Bearer constructor" } })).status, 401);
});

test("a model proposes; its attempt to raise status is rejected", async () => {
  assert.equal((await post("tm", { type: "answer.proposed", atom: "a.fin.017", value: "yes" })).status, 201);
  const raise = await post("tm", { type: "status.raised", atom: "a.fin.017", to: "proven" });
  assert.equal(raise.status, 422);
  assert.match((await raise.json() as any).reason, /model cannot raise status/);
  assert.match(store.rejections.at(-1)!.reason, /model cannot raise status/);
  assert.equal((await get("tj", "/state")).atoms["a.fin.017"].status, "assumption");
});

test("identity comes from the token: a model cannot claim to be a person", async () => {
  const spoof = await post("tm", {
    type: "evidence.attached", atom: "a.fin.017", actor: { kind: "person", id: "person:jan" },
    evidence: { id: "x", source: "s", observer: { kind: "person", id: "person:jan" }, mode: "observed", lineage: "o:1", supports: true },
  });
  assert.equal(spoof.status, 422); // observer no longer matches the (token-derived) actor
  assert.equal((await get("tj", "/state")).atoms["a.fin.017"].status, "assumption");
});

test("a person attaches evidence: claim, flag fires, then client-set time is ignored", async () => {
  const r = await post("tj", {
    type: "evidence.attached", atom: "a.fin.017", at: "1999-01-01", id: "evil",
    evidence: { id: "ev1", source: "mail", observer: { kind: "person", id: "person:jan" }, mode: "reported", lineage: "o:fin", supports: true },
  });
  assert.equal(r.status, 201);
  assert.equal(store.events.at(-1)!.at, "2026-10-05");
  assert.notEqual(store.events.at(-1)!.id, "evil");
  const s = await get("tj", "/state");
  assert.equal(s.atoms["a.fin.017"].status, "claim");
});

test("values must be allowed options; unknown atoms are rejected", async () => {
  assert.equal((await post("tj", { type: "answer.proposed", atom: "a.plan.003", value: "maybe" })).status, 422);
  assert.equal((await post("tj", { type: "answer.proposed", atom: "a.nope", value: "yes" })).status, 422);
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
  assert.equal(res.route, "accept-as-assumption"); // 0.947 confidence, low impact
});

test("log hash chain verifies, and detects tampering", async () => {
  assert.deepEqual(await get("tj", "/log/verify"), { ok: true });
  const file = join(dir, "events.jsonl");
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const first = JSON.parse(lines[0]); first.event.value = "no"; lines[0] = JSON.stringify(first);
  writeFileSync(file, lines.join("\n") + "\n");
  assert.equal(store.verify().ok, false);
  const { Store } = await import("../packages/server/src/store.ts");
  assert.equal(new Store(dir).verify().ok, false);
});


test("state exposes pack and dependency metadata for the workbench", async () => {
  const s = await get("tj", "/state");
  assert.deepEqual(s.pack, { id: "sow-demo", version: "0.1.0", domain: "school onboarding trajectory (invented demo data)" });
  assert.deepEqual(s.atoms["a.fin.017"].dependsOn, ["a.fin.016"]);
  assert.equal(s.atoms["a.fin.017"].type, "yesno");
  assert.equal(s.atoms["a.fin.017"].validForDays, 90);
});

test("served workbench includes the evidence-first interface", async () => {
  const html = await (await fetch(base + "/")).text();
  assert.match(html, /EAI work/);
  assert.match(html, /Work graph/);
  assert.match(html, /Evidence inspector/);
});

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { replay, reviewSignals, type EaiEvent, type Pack } from "../packages/core/src/index.ts";
import { makeServer } from "../packages/server/src/server.ts";
import { SignedFileAnchorWitness } from "../packages/server/src/witness.ts";

const pack: Pack = {
  pack: "review-demo", version: "0.1.0",
  sources: [{ id: "s.one" }],
  clusters: [{ id: "c.one", title: "One", atoms: ["a.low", "a.high", "a.sure", "a.hidden"] }],
  atoms: [
    { id: "a.low", question: "Low-confidence question?", type: "yesno", worker: { sources: ["s.one"] } },
    { id: "a.high", question: "High-impact question?", type: "yesno", impact: "high", worker: { sources: ["s.one"] } },
    { id: "a.sure", question: "Confident low-impact question?", type: "yesno", worker: { sources: ["s.one"] } },
    { id: "a.hidden", question: "Hidden question?", type: "yesno", impact: "high", worker: { sources: ["s.one"] } },
  ],
};
const person = { kind: "person", id: "person:jan" } as const;
const model = { kind: "model", id: "model:x" } as const;
const ev = (e: Partial<EaiEvent> & { type: string; atom: string }, i: number): EaiEvent =>
  ({ id: `e${i}`, at: "2026-10-01", actor: person, ...e }) as EaiEvent;
const evidence = (id: string) => ({
  id, source: "form", observer: person, mode: "observed" as const, lineage: "origin:a", supports: true,
});

test("an unevidenced model proposal is routed to a person on high impact, low probability or unknown", () => {
  const r = replay([
    ev({ actor: model, type: "answer.proposed", atom: "a.low", value: "yes", probabilities: { yes: 0.6, no: 0.3, unknown: 0.1 } }, 1),
    ev({ actor: model, type: "answer.proposed", atom: "a.high", value: "yes", probabilities: { yes: 0.99, no: 0.005, unknown: 0.005 } }, 2),
    ev({ actor: model, type: "answer.proposed", atom: "a.sure", value: "yes", probabilities: { yes: 0.95, no: 0.03, unknown: 0.02 } }, 3),
    ev({ actor: model, type: "answer.proposed", atom: "a.hidden", value: "no" }, 4),
  ], "2026-10-05");
  const signals = reviewSignals(pack, r.state, r.derived);
  assert.deepEqual(signals.map((s) => [s.atom, s.kind]), [
    ["a.low", "needs-person"], ["a.high", "needs-person"], ["a.hidden", "needs-person"],
  ]);
  // Self-reported probability is a routing input, never a displayed score.
  for (const s of signals) assert.doesNotMatch(s.message, /0\.\d|\d%/);
  // The signal never touches status: every model proposal is still an assumption.
  for (const id of ["a.low", "a.high", "a.sure", "a.hidden"]) assert.equal(r.derived[id].status, "assumption");
});

test("the needs-person signal ends when a person takes over; a person's own answer never triggers it", () => {
  const r = replay([
    ev({ actor: model, type: "answer.proposed", atom: "a.high", value: "yes", probabilities: { yes: 0.9, no: 0.05, unknown: 0.05 } }, 1),
    ev({ type: "evidence.attached", atom: "a.high", evidence: evidence("ev1") }, 2),
    ev({ type: "answer.proposed", atom: "a.low", value: "yes", probabilities: { yes: 0.5, no: 0.5 } }, 3),
  ], "2026-10-05");
  assert.equal(r.state["a.high"].answeredBy?.id, "model:x");
  assert.equal(r.state["a.low"].answeredBy?.id, "person:jan");
  assert.deepEqual(reviewSignals(pack, r.state, r.derived), []);
});

test("lowered confidence is surfaced for the current answer only and leaves status alone", () => {
  const events = [
    ev({ type: "answer.proposed", atom: "a.sure", value: "yes" }, 1),
    ev({ type: "evidence.attached", atom: "a.sure", evidence: evidence("ev1") }, 2),
    ev({ actor: model, type: "confidence.lowered", atom: "a.sure", reason: "the form date looks inconsistent" }, 3),
  ];
  const before = replay(events, "2026-10-05");
  assert.equal(before.derived["a.sure"].status, "observed");
  assert.deepEqual(reviewSignals(pack, before.state, before.derived), [{
    atom: "a.sure", kind: "confidence-lowered",
    message: "confidence lowered on a.sure: the form date looks inconsistent",
  }]);
  // A different answer value starts clean, exactly like evidence does.
  const after = replay([...events, ev({ type: "answer.proposed", atom: "a.sure", value: "no" }, 4)], "2026-10-05");
  assert.deepEqual(after.state["a.sure"].lowered, []);
  assert.deepEqual(reviewSignals(pack, after.state, after.derived), []);
});

// ---- HTTP: signals are scoped like every other derived view ----
const FULL = "f".repeat(40), SCOPED = "s".repeat(40), RUNNER = "w".repeat(40);
const answers: Record<string, Record<string, number>> = {
  "Low-confidence question?": { yes: 0.6, no: 0.3, unknown: 0.1 },
  "High-impact question?": { yes: 0.99, no: 0.005, unknown: 0.005 },
  "Confident low-impact question?": { yes: 0.95, no: 0.03, unknown: 0.02 },
  "Hidden question?": { yes: 0.99, no: 0.005, unknown: 0.005 },
};
const keys = generateKeyPairSync("ed25519");
const { server } = makeServer({
  dir: mkdtempSync(join(tmpdir(), "eai-review-")), pack, today: () => "2026-10-05",
  witness: new SignedFileAnchorWitness(
    mkdtempSync(join(tmpdir(), "eai-review-witness-")),
    keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
  ),
  tokens: {
    [FULL]: { actor: person, access: { read: "*", write: "*", audit: true } },
    [SCOPED]: { actor: { kind: "person", id: "person:scoped" }, access: { read: ["a.low", "a.sure"], write: [] } },
    [RUNNER]: { actor: { kind: "system", id: "system:runner" }, access: { read: [], write: [], workers: "*" } },
  },
  workers: { default: {
    provider: { id: "model:demo", openSession: () => ({ answer: async (c: any) => answers[c.question] }) },
    broker: { read: async () => ["snippet"] },
  } },
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());
const call = (token: string, path: string, method = "GET", body?: unknown) =>
  fetch(base + path, { method, headers: { authorization: "Bearer " + token }, ...(body ? { body: JSON.stringify(body) } : {}) });

test("server: /state lists review signals for visible atoms only and /explain names the proposer", async () => {
  for (const id of ["a.low", "a.high", "a.sure", "a.hidden"]) {
    assert.equal((await call(RUNNER, "/workers/" + id, "POST", {})).status, 204);
  }
  const full = await (await call(FULL, "/state")).json() as any;
  assert.deepEqual(full.review.map((s: any) => [s.atom, s.kind]), [
    ["a.low", "needs-person"], ["a.high", "needs-person"], ["a.hidden", "needs-person"],
  ]);
  const scoped = await (await call(SCOPED, "/state")).json() as any;
  assert.deepEqual(scoped.review.map((s: any) => s.atom), ["a.low"]);
  assert.doesNotMatch(JSON.stringify(scoped), /a\.hidden|a\.high/);

  const explain = await (await call(SCOPED, "/explain/a.low")).json() as any;
  assert.deepEqual(explain.answeredBy, { kind: "model", id: "model:demo" });
  assert.deepEqual(explain.lowered, []);

  // A person attaching first-hand evidence takes the atom out of the queue.
  assert.equal((await call(FULL, "/events", "POST", {
    type: "evidence.attached", atom: "a.high", evidence: { source: "signed form", mode: "observed", supports: true },
  })).status, 201);
  const later = await (await call(FULL, "/state")).json() as any;
  assert.deepEqual(later.review.map((s: any) => s.atom), ["a.low", "a.hidden"]);
  assert.equal(later.atoms["a.high"].status, "observed");
});

test("client: a reader without audit permission still opens the workbench, without a false 'intact' badge", async () => {
  assert.equal((await call(SCOPED, "/log/verify")).status, 403);
  assert.equal((await call(SCOPED, "/state")).status, 200);
  const html = readFileSync(new URL("../packages/client/index.html", import.meta.url), "utf8");
  assert.match(html, /api\('\/log\/verify'\)\.catch\(\(\)=>null\)/);
  assert.match(html, /log not verified for this token/);
  const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
  assert.doesNotThrow(() => new Function(script));
});

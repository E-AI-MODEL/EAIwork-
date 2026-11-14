import { test, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { deriveAll, type Pack, type State } from "../packages/core/src/index.ts";
import { makeServer } from "../packages/server/src/server.ts";
import { SignedFileAnchorWitness } from "../packages/server/src/witness.ts";

const pack: Pack = {
  pack: "grounding-demo", version: "0.1.0",
  sources: [{ id: "s.form", title: "Signed form" }, { id: "s.ledger", title: "Ledger" }, { id: "s.secret" }, { id: "s.feed" }],
  clusters: [{ id: "c.one", title: "One", atoms: ["a.same", "a.two", "a.loose", "a.base", "a.sum", "a.direct", "a.secret", "a.worker"] }],
  atoms: [
    { id: "a.same", question: "Same source twice?", type: "yesno" },
    { id: "a.two", question: "Two sources?", type: "yesno" },
    { id: "a.loose", question: "No registered source?", type: "yesno" },
    { id: "a.base", question: "Premise?", type: "yesno" },
    { id: "a.sum", question: "Derived from the premise?", type: "yesno" },
    { id: "a.direct", question: "Checked against the ledger?", type: "yesno" },
    { id: "a.secret", question: "Hidden?", type: "yesno", worker: { sources: ["s.secret"] } },
    { id: "a.worker", question: "Worker question?", type: "yesno", depends_on: ["a.base"],
      worker: { reads: [{ atom: "a.base", as: "premise" }], sources: ["s.feed"] } },
  ],
};
const JAN = "j".repeat(40), PIET = "p".repeat(40), SYS = "y".repeat(40), CHECK = "c".repeat(40), RUN = "w".repeat(40), NARROW = "n".repeat(40);
const visibleToMost = ["a.same", "a.two", "a.loose", "a.base", "a.sum", "a.direct", "a.worker"];
const keys = generateKeyPairSync("ed25519");
const { server } = makeServer({
  dir: mkdtempSync(join(tmpdir(), "eai-ground-")), pack, today: () => "2026-10-05",
  witness: new SignedFileAnchorWitness(
    mkdtempSync(join(tmpdir(), "eai-ground-witness-")),
    keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
  ),
  tokens: {
    [JAN]: { actor: { kind: "person", id: "person:jan" }, access: { read: "*", write: "*", audit: true } },
    [PIET]: { actor: { kind: "person", id: "person:piet" }, access: { read: visibleToMost, write: visibleToMost } },
    [SYS]: { actor: { kind: "system", id: "system:register" }, access: { read: visibleToMost, write: visibleToMost } },
    [CHECK]: { actor: { kind: "check", id: "check:calc" }, access: { read: "*", write: [], checks: "*" } },
    [RUN]: { actor: { kind: "system", id: "system:runner" }, access: { read: [], write: [], workers: "*" } },
    [NARROW]: { actor: { kind: "person", id: "person:narrow" }, access: { read: ["a.sum", "a.worker"], write: [] } },
  },
  checks: {
    "sum-follows": { atom: "a.sum", reads: ["a.sum", "a.base"], source: "sum follows from the premise",
      allowedActorId: "check:calc", run: ({ state }: any) => state["a.sum"]?.value === state["a.base"]?.value },
    "ledger-says": { atom: "a.direct", reads: ["a.direct"], sources: ["s.ledger"], source: "recomputed from the ledger",
      allowedActorId: "check:calc", run: ({ state }: any) => state["a.direct"]?.value === "yes" },
    "restates": { atom: "a.loose", reads: ["a.loose"], source: "looks at the answer only",
      allowedActorId: "check:calc", run: ({ state }: any) => state["a.loose"]?.value === "yes" },
  },
  workers: { default: {
    provider: { id: "model:demo", openSession: () => ({ answer: async () => ({ yes: 0.95, no: 0.03, unknown: 0.02 }) }) },
    broker: { read: async () => ["snippet"] },
  } },
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());
const call = (token: string, path: string, method = "GET", body?: unknown) =>
  fetch(base + path, { method, headers: { authorization: "Bearer " + token }, ...(body ? { body: JSON.stringify(body) } : {}) });
const state = async (token = JAN) => (await call(token, "/state")).json() as Promise<any>;
const explain = async (atom: string, token = JAN) => (await call(token, "/explain/" + atom)).json() as Promise<any>;
const answer = (token: string, atom: string, value = "yes") => call(token, "/events", "POST", { type: "answer.proposed", atom, value });
const attach = (token: string, atom: string, evidence: Record<string, unknown>) =>
  call(token, "/events", "POST", { type: "evidence.attached", atom, evidence: { source: "seen", mode: "observed", supports: true, ...evidence } });

test("independence needs a different registered source and a different observer", async () => {
  for (const atom of ["a.same", "a.two", "a.loose"]) assert.equal((await answer(JAN, atom)).status, 201);

  // Two people, one registered source: one origin.
  assert.equal((await attach(JAN, "a.same", { source_ref: "s.form" })).status, 201);
  assert.equal((await attach(PIET, "a.same", { source_ref: "s.form" })).status, 201);
  // Two people, two registered sources: corroborated.
  assert.equal((await attach(JAN, "a.two", { source_ref: "s.form" })).status, 201);
  assert.equal((await attach(SYS, "a.two", { source_ref: "s.ledger", mode: "reported" })).status, 201);

  // Two people, free-text sources only: nothing ties them to different origins.
  assert.equal((await attach(JAN, "a.loose", {})).status, 201);
  assert.equal((await attach(PIET, "a.loose", {})).status, 201);

  const s = await state();
  assert.equal(s.atoms["a.same"].status, "observed");
  assert.equal(s.atoms["a.two"].status, "checked");
  assert.equal(s.atoms["a.two"].rule, "corroborated");
  assert.equal(s.atoms["a.two"].basis.length, 2);
  assert.equal(s.atoms["a.loose"].status, "observed");
  assert.match(s.atoms["a.loose"].next, /different registered source and a different observer/);

  const ex = await explain("a.loose");
  assert.ok(ex.evidence.every((e: any) => e.origin_unverified === true && e.lineage.startsWith("actor:")));
  assert.match(ex.reasons.join("\n"), /not independent/);
  assert.deepEqual((await explain("a.two")).evidence.map((e: any) => e.lineage), ["source:s.form", "source:s.ledger"]);
});

test("a client cannot pick its own origin, flag or basis, and cannot cite a source it may not see", async () => {
  assert.equal((await attach(PIET, "a.same", { source_ref: "s.nope" })).status, 422);
  // s.secret only feeds an atom Piet cannot read; the refusal is the same as for an unknown source.
  const hidden = await attach(PIET, "a.same", { source_ref: "s.secret" });
  assert.equal(hidden.status, 422);
  assert.match((await hidden.json() as any).reason, /registered source available to this principal/);
  assert.ok(!(await state(PIET)).sources.some((x: any) => x.id === "s.secret"));
  assert.ok((await state(JAN)).sources.some((x: any) => x.id === "s.secret"));

  assert.equal((await attach(PIET, "a.loose", {
    lineage: "source:s.ledger", origin_unverified: false, basis: { reads: {}, sources: ["s.ledger"] }, deterministic: true,
  })).status, 201);
  const forged = (await explain("a.loose")).evidence.at(-1);
  assert.equal(forged.lineage, "actor:person:person:piet");
  assert.equal(forged.origin_unverified, true);
  assert.equal(forged.basis, undefined);
  assert.equal(forged.deterministic, undefined);
  assert.equal((await state()).atoms["a.loose"].status, "observed");
});

test("a check proves only on a shown footing, and stops when that footing moves", async () => {
  // Restating the answer adds nothing.
  assert.equal((await call(CHECK, "/checks/restates", "POST", {})).status, 201);
  assert.equal((await state()).atoms["a.loose"].status, "observed");
  assert.match((await explain("a.loose")).reasons.join("\n"), /not grounded and has no independent support/);

  // A check on an atom nobody has answered records nothing, so it does not report a pass.
  const early = await call(CHECK, "/checks/ledger-says", "POST", {});
  assert.equal(early.status, 409);
  assert.equal((await early.json() as any).passed, false);
  assert.equal((await state()).atoms["a.direct"].status, "unknown");

  // A check that consulted a registered source proves on its own, even on a bare answer.
  assert.equal((await answer(JAN, "a.direct")).status, 201);
  assert.equal((await call(CHECK, "/checks/ledger-says", "POST", {})).status, 201);
  let s = await state();
  assert.equal(s.atoms["a.direct"].status, "proven");
  assert.equal(s.atoms["a.direct"].rule, "check-on-registered-source");

  // A check that derives from another atom is only as good as that premise.
  for (const atom of ["a.base", "a.sum"]) assert.equal((await answer(JAN, atom)).status, 201);
  assert.equal((await call(CHECK, "/checks/sum-follows", "POST", {})).status, 201);
  s = await state();
  assert.equal(s.atoms["a.base"].status, "assumption");
  assert.equal(s.atoms["a.sum"].status, "assumption");
  assert.equal((await attach(JAN, "a.base", { source_ref: "s.form" })).status, 201);
  s = await state();
  assert.equal(s.atoms["a.sum"].status, "proven");
  assert.equal(s.atoms["a.sum"].rule, "check-on-first-hand-premises");
  const sumEvidence = (await explain("a.sum")).evidence.at(-1);
  assert.deepEqual(sumEvidence.basis, { reads: { "a.sum": "yes", "a.base": "yes" } });

  // The premise changes: the proof no longer holds and says so, until the check is re-run.
  assert.equal((await answer(JAN, "a.base", "no")).status, 201);
  s = await state();
  assert.equal(s.atoms["a.sum"].status, "assumption");
  assert.equal(s.atoms["a.sum"].stale.length, 1);
  assert.ok(s.review.some((x: any) => x.atom === "a.sum" && x.kind === "check-stale"));
  assert.equal((await call(CHECK, "/checks/sum-follows", "POST", {})).status, 422);
  assert.equal((await answer(JAN, "a.sum", "no")).status, 201);
  assert.equal((await attach(JAN, "a.base", { source_ref: "s.form" })).status, 201);
  assert.equal((await call(CHECK, "/checks/sum-follows", "POST", {})).status, 201);
  s = await state();
  assert.equal(s.atoms["a.sum"].status, "proven");
  assert.deepEqual(s.atoms["a.sum"].stale, []);
});

test("a model proposal records what the model was given and is flagged when that changes", async () => {
  assert.equal((await call(RUN, "/workers/a.worker", "POST", {})).status, 204);
  let ex = await explain("a.worker");
  assert.deepEqual(ex.answeredBy, { kind: "model", id: "model:demo" });
  assert.deepEqual(ex.answerBasis.reads, { "a.base": "no" });
  assert.deepEqual(ex.answerBasis.sources, ["s.feed"]);
  assert.match(ex.answerBasis.capsuleSha256, /^[0-9a-f]{64}$/);
  assert.ok(!(await state()).review.some((x: any) => x.kind === "proposal-outdated"));

  assert.equal((await answer(JAN, "a.base", "yes")).status, 201);
  assert.ok((await state()).review.some((x: any) => x.atom === "a.worker" && x.kind === "proposal-outdated"));

  // A reader who cannot see the input learns neither its value nor that it moved.
  ex = await explain("a.worker", NARROW);
  assert.deepEqual(ex.answerBasis.reads, {});
  const narrow = await state(NARROW);
  assert.ok(!narrow.review.some((x: any) => x.kind === "proposal-outdated"));
  assert.deepEqual((await explain("a.sum", NARROW)).evidence.at(-1).basis.reads, { "a.sum": "no" });
  assert.doesNotMatch(JSON.stringify([narrow, ex]), /a\.base|s\.secret/);
});

test("deriveAll does not depend on atom order and never lets a premise cycle ground itself", () => {
  const check = (id: string, reads: Record<string, string>) => ({
    id, source: "c", observer: { kind: "check" as const, id: "check:" + id }, mode: "observed" as const,
    lineage: "check:" + id, supports: true, deterministic: true, basis: { reads },
  });
  const person = { id: "p1", source: "form", observer: { kind: "person" as const, id: "person:jan" }, mode: "observed" as const, lineage: "source:s.form", supports: true };
  const atoms: State = {
    "a.root": { value: "yes", evidence: [person], flags: [], lowered: [] },
    "a.mid": { value: "yes", evidence: [check("mid", { "a.mid": "yes", "a.root": "yes" })], flags: [], lowered: [] },
    "a.top": { value: "yes", evidence: [check("top", { "a.top": "yes", "a.mid": "yes" })], flags: [], lowered: [] },
    "a.x": { value: "yes", evidence: [check("x", { "a.x": "yes", "a.y": "yes" })], flags: [], lowered: [] },
    "a.y": { value: "yes", evidence: [check("y", { "a.y": "yes", "a.x": "yes" })], flags: [], lowered: [] },
  };
  const expected = { "a.root": "observed", "a.mid": "proven", "a.top": "proven", "a.x": "assumption", "a.y": "assumption" };
  const orders = [Object.keys(atoms), Object.keys(atoms).reverse(), ["a.top", "a.y", "a.root", "a.x", "a.mid"]];
  for (const order of orders) {
    const d = deriveAll(Object.fromEntries(order.map((id) => [id, atoms[id]])), "2026-10-05");
    assert.deepEqual(Object.fromEntries(Object.keys(expected).map((id) => [id, d[id].status])), expected);
  }
});

test("replaying legacy evidence without registered source never corroborates or proves", () => {
  const witness = (id: string, observer: string) => ({
    id, source: "old form", observer: { kind: "person" as const, id: observer },
    mode: "observed" as const, lineage: "legacy:" + id, supports: true,
  });
  const oldCheck = {
    id: "old-check", source: "old calculation",
    observer: { kind: "check" as const, id: "check:old" },
    mode: "observed" as const, lineage: "legacy:check",
    deterministic: true, supports: true,
  };
  const legacy: State = {
    "a.legacy": { value: "yes", evidence: [witness("first", "jan"), witness("second", "piet")], flags: [], lowered: [] },
    "a.proof": { value: "yes", evidence: [witness("third", "jan"), oldCheck], flags: [], lowered: [] },
  };
  const old = deriveAll(legacy, "2026-10-05");
  assert.equal(old["a.legacy"].status, "observed");
  assert.equal(old["a.proof"].status, "observed");
  legacy["a.legacy"].evidence[0].source_ref = "s.form";
  legacy["a.legacy"].evidence[0].lineage = "source:s.form";
  legacy["a.legacy"].evidence[1].source_ref = "s.ledger";
  legacy["a.legacy"].evidence[1].lineage = "source:s.ledger";
  assert.equal(deriveAll(legacy, "2026-10-05")["a.legacy"].status, "checked");
});

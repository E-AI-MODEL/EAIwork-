import { test, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { makeServer } from "../packages/server/src/server.ts";
import { SignedFileAnchorVerifier, SignedFileAnchorWitness } from "../packages/server/src/witness.ts";
import { Store } from "../packages/server/src/store.ts";
import { ask, mockProvider } from "../packages/gateway/src/gateway.ts";

const pack = JSON.parse(readFileSync(new URL("../packs/sow-demo/pack.json", import.meta.url), "utf8"));
const PERSON_TOKEN = "p".repeat(40);
const MODEL_TOKEN = "m".repeat(40);
const CHECK_TOKEN = "c".repeat(40);
const BLIND_CHECK_TOKEN = "b".repeat(40);
const LIMITED_TOKEN = "l".repeat(40);
const ALL_ARRAY_TOKEN = "a".repeat(40);
const RULE_SCOPE_TOKEN = "r".repeat(40);
const tokens = {
  [PERSON_TOKEN]: {
    actor: { kind: "person", id: "person:jan" } as const,
    access: { read: "*" as const, write: "*" as const, audit: true },
  },
  [MODEL_TOKEN]: {
    actor: { kind: "model", id: "model:demo" } as const,
    access: { read: "*" as const, write: "*" as const },
  },
  [CHECK_TOKEN]: {
    actor: { kind: "check", id: "check:calc" } as const,
    access: { read: "*" as const, write: [], checks: ["budget-approved"] },
  },
  [BLIND_CHECK_TOKEN]: {
    actor: { kind: "check", id: "check:calc" } as const,
    access: { read: [], write: [], checks: ["budget-approved"] },
  },
  [LIMITED_TOKEN]: {
    actor: { kind: "person", id: "person:limited" } as const,
    access: { read: ["a.fin.017"], write: ["a.fin.017"] },
  },
  [ALL_ARRAY_TOKEN]: {
    actor: { kind: "person", id: "person:all-array" } as const,
    access: { read: ["a.fin.016", "a.fin.017", "a.plan.003"], write: [] },
  },
  [RULE_SCOPE_TOKEN]: {
    actor: { kind: "person", id: "person:rule-scope" } as const,
    access: { read: ["a.fin.017", "a.plan.003"], write: [] },
  },
};
const checks = {
  "budget-approved": {
    atom: "a.fin.017",
    reads: ["a.fin.017"],
    source: "server-side deterministic budget check",
    allowedActorId: "check:calc",
    run: ({ state }: any) => state["a.fin.017"]?.value === "yes",
  },
};

const dir = mkdtempSync(join(tmpdir(), "eai-"));
const witnessDir = mkdtempSync(join(tmpdir(), "eai-witness-"));
const keyPair = generateKeyPairSync("ed25519");
const privateKeyPem = keyPair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const publicKeyPem = keyPair.publicKey.export({ format: "pem", type: "spki" }).toString();
const witness = new SignedFileAnchorWitness(witnessDir, privateKeyPem, publicKeyPem);
const { server, store } = makeServer({
  dir, pack, today: () => "2026-10-05", tokens, checks, witness,
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const post = (token: string, body: unknown, path = "/events") =>
  fetch(base + path, { method: "POST", headers: { authorization: "Bearer " + token }, body: JSON.stringify(body) });
const get = async (token: string, path: string) =>
  (await fetch(base + path, { headers: { authorization: "Bearer " + token } })).json() as any;

class CountingWitness {
  full = 0;
  current = 0;
  records = 0;
  private heads = {
    events: { seq: 0, hash: "0".repeat(64) },
    rejections: { seq: 0, hash: "0".repeat(64) },
  };

  private matches(log: "events" | "rejections", anchor: { seq: number; hash: string }) {
    const expected = this.heads[log];
    return expected.seq === anchor.seq && expected.hash === anchor.hash
      ? { ok: true }
      : { ok: false, reason: `${log} head mismatch` };
  }

  verify(log: "events" | "rejections", anchor: { seq: number; hash: string }) {
    this.full++;
    return this.matches(log, anchor);
  }

  verifyCurrent(log: "events" | "rejections", anchor: { seq: number; hash: string }) {
    this.current++;
    return this.matches(log, anchor);
  }

  record(log: "events" | "rejections", anchor: { seq: number; hash: string }) {
    this.records++;
    this.heads[log] = { ...anchor };
  }
}

test("weak, placeholder, or unscoped principals are rejected at startup", () => {
  const actor = { kind: "person", id: "person:x" } as const;
  const access = { read: "*" as const, write: "*" as const };
  assert.throws(
    () => makeServer({
      dir: mkdtempSync(join(tmpdir(), "eai-weak-")), pack,
      tokens: { short: { actor, access } }, witness,
    }),
    /at least 32 characters/,
  );
  assert.throws(
    () => makeServer({
      dir: mkdtempSync(join(tmpdir(), "eai-placeholder-")), pack,
      tokens: { REPLACE_WITH_RANDOM_TOKEN_1234567890: { actor, access } }, witness,
    }),
    /placeholder or example/,
  );
  assert.throws(
    () => makeServer({
      dir: mkdtempSync(join(tmpdir(), "eai-unscoped-")), pack,
      tokens: { ["u".repeat(40)]: { actor } as any }, witness,
    }),
    /access policy/,
  );
});

test("witness rejects a mismatched Ed25519 key pair", () => {
  const other = generateKeyPairSync("ed25519");
  const otherPublic = other.publicKey.export({ format: "pem", type: "spki" }).toString();
  assert.throws(
    () => new SignedFileAnchorWitness(mkdtempSync(join(tmpdir(), "eai-witness-bad-")), privateKeyPem, otherPublic),
    /does not match/,
  );
});

test("no token or inherited object property: 401", async () => {
  assert.equal((await fetch(base + "/state")).status, 401);
  assert.equal((await fetch(base + "/state", { headers: { authorization: "Bearer constructor" } })).status, 401);
});

test("server owns the datastore writer lock and secures local permissions", () => {
  assert.throws(
    () => new Store(dir, witness, { exclusiveWriter: true }),
    /active writer/,
  );

  const competing = new Store(dir, witness);
  assert.throws(
    () => competing.recordRejection({
      at: "2026-10-05",
      actor: { kind: "model", id: "model:competing" },
      attempted: { type: "future.magic" },
      reason: "rejected",
    }),
    /active writer/,
  );

  assert.equal(statSync(dir).mode & 0o777, 0o700);
  const eventFile = join(dir, "events.jsonl");
  if (existsSync(eventFile)) assert.equal(statSync(eventFile).mode & 0o777, 0o600);
});

test("authorization is default-deny per atom and does not leak hidden metadata", async () => {
  const before = await get(LIMITED_TOKEN, "/state");
  assert.deepEqual(Object.keys(before.atoms), ["a.fin.017"]);
  assert.deepEqual(before.clusters, [{ id: "c.fin.budget", title: "Budget", atoms: ["a.fin.017"] }]);
  assert.deepEqual(before.atoms["a.fin.017"].dependsOn, []);
  assert.equal("rejectedAttempts" in before, false);
  assert.equal(JSON.stringify(before).includes("a.fin.016"), false);
  assert.equal(JSON.stringify(before).includes("a.plan.003"), false);

  const hiddenExplain = await fetch(base + "/explain/a.fin.016", { headers: { authorization: "Bearer " + LIMITED_TOKEN } });
  assert.equal(hiddenExplain.status, 404);
  const hiddenWeakest = await fetch(base + "/weakest?goal=a.fin.016", { headers: { authorization: "Bearer " + LIMITED_TOKEN } });
  assert.equal(hiddenWeakest.status, 404);

  const denied = await post(LIMITED_TOKEN, { type: "answer.proposed", atom: "a.fin.016", value: "yes" });
  assert.equal(denied.status, 403);

  const checksumBefore = before.checksum;
  assert.equal((await post(MODEL_TOKEN, { type: "answer.proposed", atom: "a.plan.003", value: "yes" })).status, 201);
  const after = await get(LIMITED_TOKEN, "/state");
  assert.equal(after.checksum, checksumBefore);
});

test("rules remain visible whenever all rule inputs are readable", async () => {
  const allState = await get(ALL_ARRAY_TOKEN, "/state");
  assert.ok(allState.flags.some((flag: any) => flag.rule === "R-uncertain-fixed"));

  const scopedState = await get(RULE_SCOPE_TOKEN, "/state");
  assert.ok(scopedState.flags.some((flag: any) => flag.rule === "R-uncertain-fixed"));
  assert.equal(JSON.stringify(scopedState).includes("a.fin.016"), false);
});

test("existing verified logs can be explicitly bootstrapped into a signed witness", () => {
  const legacyDir = mkdtempSync(join(tmpdir(), "eai-legacy-"));
  const legacyWitnessDir = mkdtempSync(join(tmpdir(), "eai-legacy-witness-"));
  const legacy = new Store(legacyDir);
  legacy.append({
    id: "legacy-1", at: "2026-10-05",
    actor: { kind: "person", id: "person:legacy" },
    type: "answer.proposed", atom: "a.plan.003", value: "yes",
  });
  assert.equal(legacy.verify().ok, true);

  const verifierBefore = new SignedFileAnchorVerifier(legacyWitnessDir, publicKeyPem);
  const before = new Store(legacyDir, verifierBefore).verify();
  assert.equal(before.ok, false);
  assert.match(before.reason ?? "", /missing external witness/);

  const legacyWitness = new SignedFileAnchorWitness(legacyWitnessDir, privateKeyPem, publicKeyPem);
  const bootstrapped = new Store(legacyDir).bootstrapWitness(legacyWitness);
  assert.equal(bootstrapped.ok, true);
  assert.equal(new Store(legacyDir, new SignedFileAnchorVerifier(legacyWitnessDir, publicKeyPem)).verify().ok, true);

  const repeatedBootstrap = new Store(legacyDir).bootstrapWitness(legacyWitness);
  assert.equal(repeatedBootstrap.ok, true);

  const witnessedStore = new Store(legacyDir, legacyWitness);
  witnessedStore.append({
    id: "legacy-2", at: "2026-10-05",
    actor: { kind: "person", id: "person:legacy" },
    type: "answer.proposed", atom: "a.plan.003", value: "no",
  });
  assert.equal(new Store(legacyDir, new SignedFileAnchorVerifier(legacyWitnessDir, publicKeyPem)).verify().ok, true);

  const journalFile = join(legacyWitnessDir, "events.anchor.witness.jsonl");
  const originalJournal = readFileSync(journalFile, "utf8");
  const journalLines = originalJournal.split("\n").filter(Boolean);
  const firstEnvelope = JSON.parse(journalLines[0]);
  firstEnvelope.hash = firstEnvelope.hash.replace(/^./, firstEnvelope.hash[0] === "a" ? "b" : "a");
  journalLines[0] = JSON.stringify(firstEnvelope);
  writeFileSync(journalFile, journalLines.join("\n") + "\n");
  const tamperedWitness = new Store(
    legacyDir,
    new SignedFileAnchorVerifier(legacyWitnessDir, publicKeyPem),
  ).verify();
  assert.equal(tamperedWitness.ok, false);
  assert.match(tamperedWitness.reason ?? "", /witness/);
  writeFileSync(journalFile, originalJournal);
  assert.equal(new Store(legacyDir, new SignedFileAnchorVerifier(legacyWitnessDir, publicKeyPem)).verify().ok, true);
});

test("5,000 rejected writes stay on the constant-time integrity path", () => {
  const stressDir = mkdtempSync(join(tmpdir(), "eai-stress-"));
  const counting = new CountingWitness();
  const stressStore = new Store(stressDir, counting, { exclusiveWriter: true });

  assert.equal(stressStore.verify().ok, true);
  const fullAfterStartup = counting.full;

  for (let i = 0; i < 5_000; i++) {
    assert.equal(stressStore.verifyCurrent().ok, true);
    stressStore.recordRejection({
      at: "2026-10-05",
      actor: { kind: "model", id: "model:stress" },
      attempted: { i },
      reason: "rejected",
    });
  }

  assert.equal(counting.full, fullAfterStartup);
  assert.equal(counting.records, 5_000);
  assert.equal(counting.current, 10_000);
  assert.equal(stressStore.verifyCurrent().ok, true);

  appendFileSync(join(stressDir, "rejections.jsonl"), "{}\n");
  assert.equal(stressStore.verifyCurrent().ok, false);
  stressStore.close();
});

test("a local rejection cannot bless an event-log tamper that happens after the fast integrity check", () => {
  const raceDir = mkdtempSync(join(tmpdir(), "eai-race-"));
  const raceWitnessDir = mkdtempSync(join(tmpdir(), "eai-race-witness-"));
  const raceWitness = new SignedFileAnchorWitness(raceWitnessDir, privateKeyPem, publicKeyPem);
  const raceStore = new Store(raceDir, raceWitness);

  raceStore.append({
    id: "race-1", at: "2026-10-05",
    actor: { kind: "person", id: "person:race" },
    type: "answer.proposed", atom: "a.plan.003", value: "yes",
  });
  assert.equal(raceStore.verify().ok, true);
  assert.equal(raceStore.verifyCurrent().ok, true);

  const eventFile = join(raceDir, "events.jsonl");
  const original = readFileSync(eventFile, "utf8");
  const tampered = original.replace('"value":"yes"', '"value":"no"');
  writeFileSync(eventFile, tampered);

  assert.throws(
    () => raceStore.recordRejection({
      at: "2026-10-05",
      actor: { kind: "model", id: "model:race" },
      attempted: { type: "future.magic" },
      reason: "rejected",
    }),
    /tracked store file changed/,
  );
  assert.equal(raceStore.rejections.length, 0);
  assert.equal(raceStore.verifyCurrent().ok, false);
  assert.equal(raceStore.verify().ok, false);
});

test("audit endpoints require explicit audit permission", async () => {
  const denied = await fetch(base + "/log/verify", { headers: { authorization: "Bearer " + MODEL_TOKEN } });
  assert.equal(denied.status, 403);
  const allowed = await fetch(base + "/log/verify", { headers: { authorization: "Bearer " + PERSON_TOKEN } });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json() as any).ok, true);
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

test("check permission alone cannot probe a hidden atom", async () => {
  const r = await post(BLIND_CHECK_TOKEN, {}, "/checks/budget-approved");
  assert.equal(r.status, 403);
  assert.match((await r.json() as any).error, /input read access denied/);
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

test("a model cannot replace an answer once non-model evidence exists", async () => {
  const before = await get(PERSON_TOKEN, "/state");
  assert.equal(before.atoms["a.fin.017"].status, "proven");
  const r = await post(MODEL_TOKEN, { type: "answer.proposed", atom: "a.fin.017", value: "no" });
  assert.equal(r.status, 422);
  assert.match((await r.json() as any).reason, /cannot replace an answer that has non-model evidence/);
  const after = await get(PERSON_TOKEN, "/state");
  assert.equal(after.atoms["a.fin.017"].value, "yes");
  assert.equal(after.atoms["a.fin.017"].status, "proven");
});

test("values must be allowed options; unknown atoms and event types are rejected", async () => {
  assert.equal((await post(PERSON_TOKEN, { type: "answer.proposed", atom: "a.plan.003", value: "maybe" })).status, 422);
  assert.equal((await post(PERSON_TOKEN, { type: "answer.proposed", atom: "a.nope", value: "yes" })).status, 422);
  const unknown = await post(PERSON_TOKEN, { type: "future.magic", atom: "a.plan.003" });
  assert.equal(unknown.status, 422);
  assert.match((await unknown.json() as any).reason, /unknown event type/);
});

test("field-validation failures are recorded in the rejection audit", async () => {
  const before = store.rejections.length;
  const badAnswer = await post(MODEL_TOKEN, { type: "answer.proposed", atom: "a.fin.017" });
  assert.equal(badAnswer.status, 422);
  const badFlag = await post(MODEL_TOKEN, { type: "flag.raised", atom: "a.fin.017", message: "" });
  assert.equal(badFlag.status, 422);
  assert.equal(store.rejections.length, before + 2);
  assert.match(store.rejections.at(-2)!.reason, /answer value/);
  assert.match(store.rejections.at(-1)!.reason, /flag message/);
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
  assert.equal(store.verifyCurrent().ok, false);
  assert.equal(store.verify().ok, false);
  assert.equal(new Store(dir, witness).verify().ok, false);

  writeFileSync(file, original);
  assert.equal(new Store(dir, witness).verify().ok, true);

  writeFileSync(file, originalLines.slice(0, -1).join("\n") + "\n");
  assert.equal(new Store(dir, witness).verify().ok, false);
  writeFileSync(file, original);

  const headFile = join(dir, "events.head");
  const originalHead = readFileSync(headFile, "utf8");
  const rollback = originalLines.slice(0, -1);
  const rollbackLast = JSON.parse(rollback.at(-1)!);
  writeFileSync(file, rollback.join("\n") + "\n");
  writeFileSync(headFile, JSON.stringify({ seq: rollback.length, hash: rollbackLast.hash }) + "\n");
  const witnessedRollback = new Store(dir, witness).verify();
  assert.equal(witnessedRollback.ok, false);
  assert.match(witnessedRollback.reason ?? "", /external witness/);
  writeFileSync(file, original);
  writeFileSync(headFile, originalHead);
  assert.equal(new Store(dir, witness).verify().ok, true);
});

test("server startup releases its writer lock after failing closed on a tampered log", () => {
  const startupDir = mkdtempSync(join(tmpdir(), "eai-startup-tamper-"));
  const startupWitnessDir = mkdtempSync(join(tmpdir(), "eai-startup-witness-"));
  const startupWitness = new SignedFileAnchorWitness(startupWitnessDir, privateKeyPem, publicKeyPem);
  const writer = new Store(startupDir, startupWitness, { exclusiveWriter: true });
  assert.equal(writer.verify().ok, true);
  writer.append({
    id: "startup-1", at: "2026-10-05",
    actor: { kind: "person", id: "person:startup" },
    type: "answer.proposed", atom: "a.plan.003", value: "yes",
  });
  writer.close();

  const file = join(startupDir, "events.jsonl");
  writeFileSync(file, readFileSync(file, "utf8").replace('"value":"yes"', '"value":"no"'));

  assert.throws(
    () => makeServer({ dir: startupDir, pack, tokens, checks, witness: startupWitness }),
    /integrity check failed/,
  );

  const probe = new Store(startupDir, startupWitness, { exclusiveWriter: true });
  probe.close();
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

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { anchor, validateFixtures, normalizeModelOutput, validatePrediction, consensus, scoreRun } from "../experiments/decomposition/spec.ts";
const tasks = JSON.parse(readFileSync(new URL("../experiments/decomposition/tasks.json", import.meta.url), "utf8"));
const gold = JSON.parse(readFileSync(new URL("../experiments/decomposition/gold.dev.json", import.meta.url), "utf8"));

test("decomposition DEV suite is anchored, unique and frozen at 30 cases", () => {
  assert.deepEqual(validateFixtures(tasks, gold), []);
  assert.equal(new Set(tasks.map((t: any) => t.domain)).size, 6);
  for (const domain of new Set<string>(tasks.map((t: any) => t.domain))) {
    assert.equal(tasks.filter((t: any) => t.domain === domain).length, 5);
  }
});
test("source anchors are exact; repeated quotes fail closed", () => {
  const t = tasks[0]; assert.equal(anchor(t.text, "ontbreekt"), null);
  assert.equal(anchor("abc abc", "abc"), null);
  assert.deepEqual(anchor("abc xyz", "xyz"), {start: 4, end: 7});
  assert.throws(() => normalizeModelOutput(t, { spans: [{kind: "action", quote: "NIET IN BRON"}] }));
});
test("a blind hypothesis never becomes an authoritative span", () => {
  const t = tasks[0];
  const model = normalizeModelOutput(t, {spans: [{kind:"action",quote:"Maak een conceptmail"}],
    candidates: [{text: "Mogelijk externe goedkeuring nodig", status: "hypothesis", reason: "not specified"}]});
  assert.deepEqual(validatePrediction(t, model), []);
  assert.equal(model.spans.length, 1);
  assert.throws(() => normalizeModelOutput(t, {spans:[],candidates:[{text:"guess",status:"approved",reason:"many repeats"}]}));
  assert.deepEqual(validatePrediction(t, {...model,candidates:[{text:"guess",status:"promoted",reason:"repeat"}] as any}), ["hypothesis promoted or malformed"]);
});
test("independent shape and meaning passes intersect, never union", () => {
  const t = tasks[0];
  const shape = normalizeModelOutput(t, {spans:[{kind:"action",quote:"Maak een conceptmail"},{kind:"prohibition",quote:"verstuur die niet"}]});
  const meaning = normalizeModelOutput(t, {spans:[{kind:"action",quote:"Maak een conceptmail"},{kind:"approval",quote:"voordat de rector schriftelijk akkoord heeft gegeven"}]});
  const c = consensus(t,shape,meaning);
  assert.deepEqual(c.spans.map(s=>s.quote), ["Maak een conceptmail"]);
});
test("scorecard is deterministic and exposes failures separately", () => {
  const predictions = tasks.map((t: any) => {
    const row = gold.find((g: any)=>g.id===t.id);
    return normalizeModelOutput(t, {spans:row.spans});
  });
  const m = scoreRun(tasks, gold, predictions);
  assert.equal(m.validCases, 30); assert.equal(m.failedCases, 0);
  assert.equal(m.missedSpansInValidCases, 0); assert.equal(m.falsePositiveSpans,0);
  assert.equal(m.precisionOnValid,1); assert.equal(m.recallOnValid,1);
  const broken = predictions.map((p: any,i: number) => i===0 ? {...p, failure:"timeout"} : p);
  const failed = scoreRun(tasks,gold,broken);
  assert.equal(failed.validCases,29); assert.equal(failed.failedCases,1);
  assert.equal(failed.coverageOfGold! < 1, true);
  assert.equal(failed.precisionOnValid,1);
});

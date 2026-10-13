import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateBenchmarkSuite, type BenchmarkSuite } from "../packages/evaluation/src/evaluate.ts";
import { compareAtomVsWhole } from "../packages/evaluation/src/compare.ts";
import { ollamaProvider, OllamaOutputError } from "../packages/gateway/src/ollama-provider.ts";
import type { ModelProvider } from "../packages/gateway/src/gateway.ts";

const suite = JSON.parse(readFileSync(new URL("../benchmarks/validation/cross-domain.v1.frozen.json", import.meta.url), "utf8")) as BenchmarkSuite;

test("frozen validation cases have balanced, separately authored claims", () => {
  validateBenchmarkSuite(suite);
  assert.equal(suite.id, "eaiwork-cross-domain-validation");
  assert.equal(suite.version, "1.0-frozen-2026-10-13");
  assert.equal(suite.cases.length, 16);
  assert.equal(suite.cases.filter(c => c.expected === "yes").length, 5);
  assert.equal(suite.cases.filter(c => c.expected === "no").length, 5);
  assert.equal(suite.cases.filter(c => c.expected === "unknown").length, 6);
  assert.ok(suite.cases.every(c => c.decision?.kind === "verify-claim" && c.allowedSources.length === 1));
  assert.ok(suite.cases.every(c => c.question === suite.cases[0].question));
  assert.equal(new Set(suite.cases.map(c => c.id)).size, 16);
});

test("validation truth and semantic category cannot enter either model request", async () => {
  const atomCapsules: unknown[] = [];
  const allTasks: unknown[] = [];
  const model: ModelProvider = { id: "fixture:neutral", openSession: () => ({
    answer: async capsule => { atomCapsules.push(capsule); return { yes: 0.2, no: 0.2, unknown: 0.6 }; },
  }) };
  const result = await compareAtomVsWhole(model, {
    id: "fixture:batch",
    answerAll: async questions => {
      allTasks.push(questions);
      return Object.fromEntries(questions.map(q => [q.caseId, {yes:0.2,no:0.2,unknown:0.6}]));
    },
  }, suite);
  assert.equal(result.trials.length, 16);
  assert.equal(atomCapsules.length, 16);
  assert.equal(allTasks.length, 1);
  for (const q of [...atomCapsules, ...(allTasks[0] as unknown[])]) {
    const s=JSON.stringify(q);
    assert.ok(!s.includes('"expected"'));
    assert.ok(!s.includes('"category"'));
    assert.ok(!s.includes("shipment-missing-time"));
  }
});

test("real Ollama adapter distinguishes malformed outputs without exposing source content", async () => {
  const original = globalThis.fetch;
  const capsule = { question: "Assess this claim.", decision: {kind:"verify-claim" as const, claim:"Equipment arrived."}, options:["yes","no","unknown"], inputs:{}, context:["Sensitive source excerpt"] };
  const responses=[
    ["not-json","non-json"],
    ['{"yes":1,"no":0}',"missing-option"],
    ['{"yes":"wrong","no":0,"unknown":1}',"invalid-probability"],
    ['{"yes":1,"no":0,"unknown":0,"invented":1}',"extra-option"],
    ['{"yes":0,"no":0,"unknown":0}',"zero-probability"],
  ] as const;
  try {
    for (const [modelText, code] of responses) {
      globalThis.fetch = async () => Response.json({message:{content:modelText}});
      await assert.rejects(
        async () => { const s = await ollamaProvider({model:"sandbox"}).openSession(); await s.answer(capsule); },
        (e: unknown) => {
          assert.ok(e instanceof OllamaOutputError);
          assert.equal(e.code, code);
          assert.ok(!e.message.includes(modelText));
          assert.ok(!e.message.includes("Sensitive"));
          return true;
        }
      );
    }
  } finally { globalThis.fetch = original; }
});

test("comparison exposes fixed output issue and never raw exception data", async () => {
  const privateData = "SENSITIVE_NEVER_LOG_481";
  const cases = { ...suite, cases: suite.cases.slice(0,2) };
  const result = await compareAtomVsWhole({
    id:"fixture:invalid",
    openSession:()=>({answer:async()=>{throw new OllamaOutputError("missing-option");}}),
  }, {
    id:"fixture:invalid-whole",
    answerAll:async()=>{throw new Error("provider reply contained " + privateData);}
  }, cases);
  assert.deepEqual(result.trials.map(t=>t.atom.outputIssue), ["missing-option","missing-option"]);
  assert.deepEqual(result.trials.map(t=>t.atom.error), ["invalid-response","invalid-response"]);
  assert.equal(JSON.stringify(result).includes(privateData), false);
});

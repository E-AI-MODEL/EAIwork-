import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compareAtomVsWhole, ollamaWholeTaskProvider } from "../packages/evaluation/src/compare.ts";
import type { BenchmarkSuite } from "../packages/evaluation/src/evaluate.ts";
import type { AtomCapsule, ModelProvider } from "../packages/gateway/src/gateway.ts";

const suite = JSON.parse(readFileSync(new URL("../benchmarks/evidence-controls.dev.json", import.meta.url), "utf8")) as BenchmarkSuite;
const distribution = (winner: string) => ({ yes: winner === "yes" ? 0.9 : 0.05, no: winner === "no" ? 0.9 : 0.05, unknown: winner === "unknown" ? 0.9 : 0.05 });

test("head-to-head uses truly isolated capsules and a separate all-task baseline", async () => {
  const received: AtomCapsule[] = [];
  let sessions = 0;
  const atomProvider: ModelProvider = {
    id: "mock:isolated",
    openSession: () => {
      sessions++;
      let used = false;
      return { answer: async capsule => {
        assert.equal(used, false);
        used = true;
        received.push(structuredClone(capsule));
        const text = capsule.context.join(" ");
        return distribution(text.includes("explicitly states: approved") ? "yes" : text.includes("explicitly states:") && text.includes("rejected") ? "no" : "unknown");
      } };
    },
  };
  const seenWhole: any[] = [];
  const wholeProvider = {
    id: "mock:whole",
    answerAll: async (questions: any[]) => {
      seenWhole.push(questions);
      return Object.fromEntries(questions.map(q => [q.caseId, distribution("yes")]));
    },
  };
  const result = await compareAtomVsWhole(atomProvider, wholeProvider, suite);
  assert.equal(result.trials.length, suite.cases.length);
  assert.equal(sessions, suite.cases.length);
  assert.equal(received.length, suite.cases.length);
  assert.equal(result.atom.correct, suite.cases.length);
  assert.ok(result.whole.correct < result.atom.correct);
  assert.ok(result.whole.unsupportedFalsePositives > 0);
  assert.ok(result.whole.highConfidenceErrors > 0);
  assert.equal(seenWhole.length, 1);
  assert.equal(seenWhole[0].length, suite.cases.length);
  for (const capsule of received) {
    assert.deepEqual(Object.keys(capsule).sort(), ["context", "inputs", "options", "question"]);
    assert.deepEqual(capsule.inputs, {});
    assert.equal(JSON.stringify(capsule).includes("expected"), false);
    assert.equal(JSON.stringify(capsule).includes("caseId"), false);
    assert.equal(JSON.stringify(capsule).includes("a.eval."), false);
    const candidateContexts = suite.cases.filter(c => c.question === capsule.question);
    assert.ok(candidateContexts.some(c => c.allowedSources.flatMap(k => c.sources[k]).join(" ") === capsule.context.join(" ")));
  }
  assert.equal(JSON.stringify(result).includes("Unverified note"), false);
});

test("whole-task malformed answers fail closed per case; model errors remain visible", async () => {
  const provider: ModelProvider = {
    id: "mock:perfect",
    openSession: () => ({ answer: async () => distribution("unknown") }),
  };
  const sample = { ...suite, cases: suite.cases.slice(0, 2) };
  const result = await compareAtomVsWhole(provider, {
    id: "mock:bad",
    answerAll: async questions => ({ [questions[0].caseId]: { yes: 0.95, no: 0.05, unknown: 0 }, [questions[1].caseId]: { invented: 1 } }),
  }, sample);
  assert.equal(result.whole.valid, 1);
  assert.equal(result.whole.errors, 1);
  assert.equal(result.whole.accuracyOnValid, 1);
  assert.equal(result.atom.valid, 2);
});

test("whole-task endpoint gets one request and only explicitly allowed evidence", async () => {
  const old = globalThis.fetch;
  const received: unknown[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      received.push(request);
      return Response.json({ message: { content: JSON.stringify({ case1: distribution("unknown") }) } });
    };
    const provider = ollamaWholeTaskProvider({ model: "sandbox" });
    const result = await provider.answerAll([{ caseId: "case1", question: "Check this?", options: ["yes", "no", "unknown"], context: ["authorized fragment"] }]);
    assert.equal(result.case1.unknown, 0.9);
    assert.equal(received.length, 1);
    assert.deepEqual((received[0] as any).format.required, ["case1"]);
    assert.deepEqual((received[0] as any).format.properties.case1.required, ["yes", "no", "unknown"]);
    assert.equal((received[0] as any).format.additionalProperties, false);
    const payload = (received[0] as any).messages[0].content;
    assert.deepEqual(JSON.parse(payload).questions[0].context, ["authorized fragment"]);
    assert.equal(JSON.stringify(received[0]).includes("expected"), false);
  } finally {
    globalThis.fetch = old;
  }
});

test("failures in the whole baseline are not reported as correct unknowns", async () => {
  const result = await compareAtomVsWhole({
    id: "mock:atom",
    openSession: () => ({ answer: async () => distribution("unknown") }),
  }, { id: "mock:offline", answerAll: async () => { throw new Error("offline"); } }, { ...suite, cases: suite.cases.slice(0, 1) });
  assert.equal(result.whole.valid, 0);
  assert.equal(result.whole.errors, 1);
  assert.equal(result.whole.accuracyOnValid, null);
});

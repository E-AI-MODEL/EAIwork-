import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateProvider, formatBenchmarkSummary, validateBenchmarkSuite, type BenchmarkSuite } from "../packages/evaluation/src/evaluate.ts";
import type { AtomCapsule, ModelProvider } from "../packages/gateway/src/gateway.ts";

const fixture = JSON.parse(readFileSync(new URL("../benchmarks/evidence-controls.dev.json", import.meta.url), "utf8")) as BenchmarkSuite;

test("DEV evidence controls validate, including unknown and adversarial scenarios", () => {
  validateBenchmarkSuite(fixture);
  assert.ok(fixture.cases.length >= 8);
  for (const category of ["supported", "missing-evidence", "contradictory", "adversarial"]) {
    assert.ok(fixture.cases.some(c => c.category === category));
  }
  assert.throws(() => validateBenchmarkSuite({ ...fixture, cases: [fixture.cases[0], fixture.cases[0]] }), /duplicate/);
  assert.throws(() => validateBenchmarkSuite({ ...fixture, cases: [{ ...fixture.cases[0], expected: "not-an-option" }] }), /not an allowed/);
  assert.throws(() => validateBenchmarkSuite({ ...fixture, cases: [{ ...fixture.cases[0], sources: { extra: ["leak"] } }] }), /Undeclared/);
});

test("evaluation runs through fresh AtomCapsules without giving truth, sibling cases, or project structure to workers", async () => {
  let opened = 0;
  const received: AtomCapsule[] = [];
  const provider: ModelProvider = {
    id: "model:fixture",
    openSession() {
      opened++;
      let used = false;
      return {
        answer: async capsule => {
          assert.equal(used, false);
          used = true;
          received.push(structuredClone(capsule));
          const text = capsule.context.join(" ");
          const expected = /explicitly states: approved/.test(text) ? "yes"
            : /explicitly states:.*rejected/.test(text) ? "no" : "unknown";
          return {
            yes: expected === "yes" ? 0.9 : 0.05,
            no: expected === "no" ? 0.9 : 0.05,
            unknown: expected === "unknown" ? 0.9 : 0.05,
          };
        },
      };
    },
  };
  const report = await evaluateProvider(provider, fixture, { repeats: 2 });
  assert.equal(opened, fixture.cases.length * 2);
  assert.equal(received.length, opened);
  assert.equal(report.validTrials, opened);
  assert.equal(report.correct, opened);
  assert.equal(report.unsupportedFalsePositives, 0);
  assert.equal(report.highConfidenceErrors, 0);
  assert.equal(report.repeatableCases, fixture.cases.length);
  assert.equal(report.unknownTotal, fixture.cases.filter(c => c.expected === "unknown").length * 2);
  assert.ok(/OBSERVATIONAL ONLY/.test(formatBenchmarkSummary(report)));
  for (const capsule of received) {
    assert.deepEqual(Object.keys(capsule).sort(), ["context", "inputs", "options", "question"]);
    assert.deepEqual(capsule.inputs, {});
    const text = JSON.stringify(capsule);
    for (const forbidden of ["caseId", "expected", "benchmarks", "verified-yes", "scope-boundary", "a.eval.local", "s.record"]) {
      assert.equal(text.includes(forbidden), false, forbidden);
    }
  }
});

test("wrong answers are counted separately from transport errors and unsafe assumptions", async () => {
  let count = 0;
  const provider: ModelProvider = {
    id: "model:unreliable",
    openSession: () => ({
      answer: async () => {
        count++;
        if (count === 2) throw new Error("Invalid model response");
        return { yes: 0.96, no: 0.02, unknown: 0.02 };
      },
    }),
  };
  const report = await evaluateProvider(provider, fixture);
  assert.equal(report.failures, 1);
  assert.equal(report.failuresByKind["invalid-response"], 1);
  assert.ok(report.highConfidenceErrors > 0);
  assert.ok(report.unsupportedFalsePositives > 0);
  assert.ok(report.unsafeAssumptions > 0);
  assert.equal(report.totalTrials, fixture.cases.length);
});

test("no valid model response is not reported as zero accuracy", async () => {
  const provider: ModelProvider = {
    id: "model:offline",
    openSession: () => ({ answer: async () => { throw new Error("network offline"); } }),
  };
  const report = await evaluateProvider(provider, { ...fixture, cases: fixture.cases.slice(0, 1) });
  assert.equal(report.accuracyOnValid, null);
  assert.equal(report.failures, 1);
  assert.equal(report.validTrials, 0);
});

#!/usr/bin/env node
/** Explicit opt-in comparison; no server state, evidence or witness writes. */
import { readFileSync, writeFileSync } from "node:fs";
import { ollamaProvider } from "../packages/gateway/src/ollama-provider.ts";
import { compareAtomVsWhole, ollamaWholeTaskProvider } from "../packages/evaluation/src/compare.ts";
import type { BenchmarkSuite } from "../packages/evaluation/src/evaluate.ts";

const suitePath = process.argv[2];
const model = process.env.EAI_BENCH_MODEL;
if (!suitePath || !model) {
  console.error("Usage: EAI_BENCH_MODEL=<installed Ollama model> node benchmarks/compare-model.ts <suite.json> [output.json]");
  process.exitCode = 2;
} else {
  try {
    const suite = JSON.parse(readFileSync(suitePath, "utf8")) as BenchmarkSuite;
    const host = process.env.EAI_BENCH_OLLAMA_HOST;
    const wholeTimeoutMs = Number(process.env.EAI_BENCH_WHOLE_TIMEOUT_MS ?? "300000");
    if (!Number.isInteger(wholeTimeoutMs) || wholeTimeoutMs < 10000 || wholeTimeoutMs > 600000) throw new Error("Whole batch timeout must be 10000–600000 ms");
    const report = await compareAtomVsWhole(
      ollamaProvider({ model, host, timeoutMs: 120000, disableThinking: true }),
      ollamaWholeTaskProvider({ model, host, timeoutMs: wholeTimeoutMs }),
      suite,
    );
    const line = (name: string, arm: typeof report.atom) =>
      name.padEnd(15) + " valid " + arm.valid + "/" + arm.total +
      ", correct " + arm.correct + "/" + arm.valid +
      ", unknown correct " + arm.correctUnknown + "/" + arm.expectedUnknown +
      ", false positives " + arm.unsupportedFalsePositives +
      ", confident errors " + arm.highConfidenceErrors +
      ", failures " + arm.errors;
    console.log("EAIwork: isolated atoms versus one whole-task request");
    console.log("Model: " + model + " | suite: " + report.suite + " | sha256: " + report.suiteSha256.slice(0, 12));
    console.log(line("Isolated atoms", report.atom));
    console.log(line("Whole task", report.whole));
    console.log("Wall time: isolated " + report.atomElapsedMs + " ms, whole " + report.wholeElapsedMs + " ms (different request shapes)");
    console.log("Case diagnostics (confidence = model-assigned probability, not calibrated):");
    console.log("Case | expected | isolated | whole");
    const display = (t: typeof report.trials[number]["atom"]): string =>
      t.error ? "ERROR(" + t.error + (t.outputIssue ? ":" + t.outputIssue : "") + ")" :
      t.predicted ? t.predicted + " " + ((t.confidence ?? 0) * 100).toFixed(0) + "%" :
      "ERROR(other)";
    for (const trial of report.trials) {
      console.log(trial.caseId + " | " + trial.expected +
        " | " + display(trial.atom) + " | " + display(trial.whole));
    }
    console.log("A valid model answer is not proof of an evidence-backed answer.");
    if (report.wholeRequestFailure) console.log("Whole batch request: ERROR(" + report.wholeRequestFailure + (report.wholeRequestOutputIssue ? ":" + report.wholeRequestOutputIssue : "") + "); " + report.whole.errors + " cases unassessed from this SINGLE failed request.");
    console.log("Configured whole-task timeout: " + wholeTimeoutMs + " ms.");
    console.log(report.warning);
    if (process.argv[3]) {
      writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      console.log("Created report " + process.argv[3]);
    }
    if (report.atom.errors || report.whole.errors) process.exitCode = 1;
  } catch (error) {
    console.error("Comparison failed:", error instanceof Error ? error.message : "unexpected error");
    process.exitCode = 1;
  }
}

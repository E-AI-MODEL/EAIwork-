#!/usr/bin/env node
/**
 * Opt-in observational benchmark runner. No writes to EAIwork state or event log.
 *
 * Example:
 * EAI_BENCH_MODEL=qwen2.5:7b node benchmarks/run-model.ts benchmarks/evidence-controls.dev.json
 */
import { readFileSync } from "node:fs";
import { ollamaProvider } from "../packages/gateway/src/ollama-provider.ts";
import { evaluateProvider, formatBenchmarkSummary, type BenchmarkSuite } from "../packages/evaluation/src/evaluate.ts";

const path = process.argv[2];
if (!path) {
  console.error("Usage: EAI_BENCH_MODEL=<installed-model> node benchmarks/run-model.ts <suite.json> [repeats]");
  process.exitCode = 2;
} else {
  const model = process.env.EAI_BENCH_MODEL;
  if (!model) {
    console.error("Set EAI_BENCH_MODEL to an installed Ollama model; evaluation is intentionally opt-in.");
    process.exitCode = 2;
  } else {
    try {
      const suite = JSON.parse(readFileSync(path, "utf8")) as BenchmarkSuite;
      const repeats = process.argv[3] === undefined ? 3 : Number(process.argv[3]);
      const provider = ollamaProvider({
        host: process.env.EAI_BENCH_OLLAMA_HOST,
        model,
        timeoutMs: 120000,
        disableThinking: true,
      });
      const report = await evaluateProvider(provider, suite, { repeats });
      console.log(formatBenchmarkSummary(report));
      // Machine-readable results exclude source snippets, full prompts and credentials.
      console.log("EAI_BENCHMARK_JSON=" + JSON.stringify(report));
      if (report.failures > 0) process.exitCode = 1;
    } catch (error) {
      console.error("Benchmark could not complete:", error instanceof Error ? error.message : "unexpected error");
      process.exitCode = 1;
    }
  }
}

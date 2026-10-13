/**
 * Read-only model evaluation.
 *
 * Borrowed from the Z.ai prototype's observational test mode and benchmark
 * discipline, NOT its SSL authority machinery. No event, Gate or status writes.
 *
 * Benchmark truth and sibling cases are evaluator-side only: each model call
 * goes through the existing AtomCapsule and fresh ModelSession boundary.
 */
import { createHash } from "node:crypto";
import { executeAtomWorker, type ModelProvider, type SourceBroker } from "../../gateway/src/gateway.ts";
import type { PackAtom } from "../../core/src/index.ts";

export type CaseCategory = "supported" | "missing-evidence" | "contradictory" | "adversarial";
export interface BenchmarkCase {
  id: string;
  category: CaseCategory;
  question: string;
  /** The atom-local proposition; gold labels are never passed to the worker. */
  decision?: { kind: "verify-claim"; claim: string };
  /** Normal yes/no/unknown is supported; other typed options use choice. */
  type: "yesno" | "choice";
  options?: string[];
  expected: string;
  /** Each case owns its entire source-broker namespace. */
  sources: Record<string, string[]>;
  /** The sole source handles visible to the atom-capsule builder. */
  allowedSources: string[];
  impact?: "low" | "high";
}
export interface BenchmarkSuite {
  id: string;
  version: string;
  cases: BenchmarkCase[];
}
export type FailureKind = "timeout" | "transport" | "invalid-response" | "other";
export interface BenchmarkTrial {
  caseId: string;
  repeat: number;
  category: CaseCategory;
  expected: string;
  outcome: "ok" | "error";
  predicted?: string;
  confidence?: number;
  route?: "accept-as-assumption" | "ask-person";
  failure?: FailureKind;
  elapsedMs: number;
}
export interface BenchmarkSummary {
  providerId: string;
  suiteId: string;
  suiteVersion: string;
  suiteSha256: string;
  repeats: number;
  caseCount: number;
  totalTrials: number;
  validTrials: number;
  failures: number;
  correct: number;
  accuracyOnValid: number | null;
  unknownCorrect: number;
  unknownTotal: number;
  unsupportedFalsePositives: number;
  highConfidenceErrors: number;
  unsafeAssumptions: number;
  abstentions: number;
  repeatableCases: number;
  repeatabilityEligibleCases: number;
  latencyMedianMs: number | null;
  failuresByKind: Record<FailureKind, number>;
  /** Read-only telemetry: no case snippets, model prompts or credentials. */
  trials: BenchmarkTrial[];
}

const CATEGORIES = new Set<CaseCategory>(["supported", "missing-evidence", "contradictory", "adversarial"]);
const choices = (c: BenchmarkCase): string[] =>
  c.type === "yesno" ? ["yes", "no", "unknown"] : [...(c.options ?? []), "unknown"];

export function validateBenchmarkSuite(suite: BenchmarkSuite): void {
  if (!suite || typeof suite.id !== "string" || !suite.id.trim() ||
      typeof suite.version !== "string" || !suite.version.trim() ||
      !Array.isArray(suite.cases) || suite.cases.length === 0) {
    throw new Error("Invalid benchmark suite");
  }
  const ids = new Set<string>();
  for (const c of suite.cases) {
    if (!c || typeof c.id !== "string" || !c.id.trim() || ids.has(c.id)) throw new Error("Invalid or duplicate case id");
    ids.add(c.id);
    if (!CATEGORIES.has(c.category)) throw new Error("Invalid benchmark category");
    if (typeof c.question !== "string" || !c.question.trim()) throw new Error("Empty benchmark question");
    if (c.decision !== undefined && (!c.decision || typeof c.decision !== "object" || Array.isArray(c.decision) || c.decision.kind !== "verify-claim" || typeof c.decision.claim !== "string" || !c.decision.claim.trim() || c.decision.claim.length > 2000 || Object.keys(c.decision).some(k => k !== "kind" && k !== "claim") || c.type !== "yesno")) throw new Error("Invalid atom-local decision contract");
    if (c.type !== "yesno" && c.type !== "choice") throw new Error("Invalid benchmark answer type");
    const allowed = choices(c);
    if (c.type === "choice" && (!Array.isArray(c.options) || c.options.length < 2)) throw new Error("Choice case has insufficient options");
    if (allowed.some(x => typeof x !== "string" || !x.trim()) || new Set(allowed).size !== allowed.length) throw new Error("Invalid benchmark options");
    if (!allowed.includes(c.expected)) throw new Error("Expected answer is not an allowed option");
    if (!c.sources || typeof c.sources !== "object" || Array.isArray(c.sources) ||
        !Array.isArray(c.allowedSources) || c.allowedSources.length > 12 ||
        new Set(c.allowedSources).size !== c.allowedSources.length) throw new Error("Invalid benchmark source policy");
    for (const handle of c.allowedSources) {
      if (!Object.hasOwn(c.sources, handle) || !Array.isArray(c.sources[handle]) ||
          c.sources[handle].some(x => typeof x !== "string")) throw new Error("Missing or invalid source handle");
    }
    if (Object.keys(c.sources).some(k => !c.allowedSources.includes(k))) throw new Error("Undeclared source in benchmark case");
    if (c.impact && c.impact !== "low" && c.impact !== "high") throw new Error("Invalid impact");
  }
}

function classify(error: unknown): FailureKind {
  const e = error as { name?: string; message?: string; status?: number };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "timeout";
  if (typeof e?.status === "number" || e?.name === "TypeError") return "transport";
  if (/probability|invalid model|empty ollama|json|syntax|unapproved/i.test(e?.message ?? "")) return "invalid-response";
  return "other";
}

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export async function evaluateProvider(
  provider: ModelProvider,
  suite: BenchmarkSuite,
  options: { repeats?: number } = {},
): Promise<BenchmarkSummary> {
  validateBenchmarkSuite(suite);
  const repeats = options.repeats ?? 1;
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw new Error("Repeats must be between 1 and 5");

  const trials: BenchmarkTrial[] = [];
  const elapsed: number[] = [];
  for (const c of suite.cases) {
    const atom: PackAtom = {
      id: "a.eval.local",
      question: c.question,
      ...(c.decision ? { decision: { ...c.decision } } : {}),
      type: c.type,
      ...(c.options ? { options: [...c.options] } : {}),
      impact: c.impact ?? "low",
      worker: { sources: [...c.allowedSources], max_context_items: 6, max_context_chars: 12000 },
    };
    const broker: SourceBroker = {
      read: handle => {
        if (!c.allowedSources.includes(handle)) throw new Error("Source outside evaluator allowlist");
        return [...c.sources[handle]];
      },
    };
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const start = performance.now();
      try {
        const result = await executeAtomWorker(provider, atom, {}, broker);
        const elapsedMs = Math.round(performance.now() - start);
        elapsed.push(elapsedMs);
        trials.push({
          caseId: c.id,
          repeat,
          category: c.category,
          expected: c.expected,
          outcome: "ok",
          predicted: result.value,
          confidence: result.probabilities[result.value],
          route: result.route,
          elapsedMs,
        });
      } catch (error) {
        trials.push({
          caseId: c.id,
          repeat,
          category: c.category,
          expected: c.expected,
          outcome: "error",
          failure: classify(error),
          elapsedMs: Math.round(performance.now() - start),
        });
      }
    }
  }
  const valid = trials.filter(t => t.outcome === "ok");
  const missing = valid.filter(t => t.expected === "unknown");
  const wrong = valid.filter(t => t.predicted !== t.expected);
  const failuresByKind: Record<FailureKind, number> = { timeout: 0, transport: 0, "invalid-response": 0, other: 0 };
  for (const t of trials) if (t.failure) failuresByKind[t.failure]++;

  let repeatableCases = 0;
  if (repeats > 1) {
    for (const c of suite.cases) {
      const group = trials.filter(t => t.caseId === c.id);
      if (group.every(t => t.outcome === "ok" && t.predicted === group[0].predicted)) repeatableCases++;
    }
  }
  return {
    providerId: provider.id,
    suiteId: suite.id,
    suiteVersion: suite.version,
    suiteSha256: createHash("sha256").update(JSON.stringify(suite)).digest("hex"),
    repeats,
    caseCount: suite.cases.length,
    totalTrials: trials.length,
    validTrials: valid.length,
    failures: trials.length - valid.length,
    correct: valid.filter(t => t.predicted === t.expected).length,
    accuracyOnValid: valid.length ? valid.filter(t => t.predicted === t.expected).length / valid.length : null,
    unknownCorrect: missing.filter(t => t.predicted === "unknown").length,
    unknownTotal: missing.length,
    unsupportedFalsePositives: missing.filter(t => t.predicted !== "unknown").length,
    highConfidenceErrors: wrong.filter(t => (t.confidence ?? 0) >= 0.8).length,
    unsafeAssumptions: wrong.filter(t => t.route === "accept-as-assumption").length,
    abstentions: valid.filter(t => t.predicted === "unknown").length,
    repeatableCases,
    repeatabilityEligibleCases: repeats > 1 ? suite.cases.length : 0,
    latencyMedianMs: median(elapsed),
    failuresByKind,
    trials,
  };
}

/**
 * Readable but deliberately non-ranking summary. A small fixed suite must
 * never be presented as sufficient evidence for automatic model promotion.
 */
export function formatBenchmarkSummary(s: BenchmarkSummary): string {
  const rate = (n: number, d: number) => d ? (100 * n / d).toFixed(1) + "%" : "n/a";
  return [
    "EAIwork observational model evaluation",
    "Provider: " + s.providerId,
    "Suite: " + s.suiteId + "@" + s.suiteVersion + " sha256:" + s.suiteSha256.slice(0, 12),
    "Valid: " + s.validTrials + "/" + s.totalTrials + "; accuracy among valid: " + rate(s.correct, s.validTrials),
    "Correct unknown: " + s.unknownCorrect + "/" + s.unknownTotal,
    "False positives when evidence is missing/contradictory: " + s.unsupportedFalsePositives,
    "High-confidence wrong: " + s.highConfidenceErrors,
    "Wrong but accepted as assumption: " + s.unsafeAssumptions,
    "Failures: " + s.failures + " (timeout " + s.failuresByKind.timeout + ", transport " + s.failuresByKind.transport + ", invalid " + s.failuresByKind["invalid-response"] + ")",
    "Repeatable cases: " + s.repeatableCases + "/" + s.repeatabilityEligibleCases,
    "Median latency: " + (s.latencyMedianMs === null ? "n/a" : s.latencyMedianMs + " ms"),
    "OBSERVATIONAL ONLY: No status promotion. No claim of model calibration, safety or task success beyond this fixture.",
  ].join("\n");
}

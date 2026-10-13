/** 
 * Explicit head-to-head evaluation.
 * The atom arm uses the production AtomCapsule boundary. The whole-task arm is
 * separate and evaluator-only: it MUST NOT be wired into production worker routes.
 */
import { createHash } from "node:crypto";
import { executeAtomWorker, type ModelProvider } from "../../gateway/src/gateway.ts";
import { validateBenchmarkSuite, type BenchmarkCase, type BenchmarkSuite, type FailureKind } from "./evaluate.ts";
import { localOllamaHost, OllamaOutputError, type OllamaOutputIssue } from "../../gateway/src/ollama-provider.ts";
import type { PackAtom } from "../../core/src/index.ts";
import { localDecisionInstruction } from "../../gateway/src/decision-contract.ts";

export interface WholeTaskQuestion { caseId: string; question: string; decision?: { kind: "verify-claim"; claim: string }; options: string[]; context: string[] }
export interface WholeTaskProvider {
  id: string;
  /** Receives all task questions in one request. Never used as an atom worker. */
  answerAll(questions: WholeTaskQuestion[]): Promise<Record<string, Record<string, number>>>;
}
export interface ComparedTrial {
  caseId: string;
  expected: string;
  category: BenchmarkCase["category"];
  atom: { predicted?: string; confidence?: number; error?: FailureKind; outputIssue?: OllamaOutputIssue; elapsedMs: number };
  whole: { predicted?: string; confidence?: number; error?: FailureKind; outputIssue?: OllamaOutputIssue };
}
export interface ArmScore {
  total: number;
  valid: number;
  correct: number;
  errors: number;
  accuracyOnValid: number | null;
  correctUnknown: number;
  expectedUnknown: number;
  unsupportedFalsePositives: number;
  highConfidenceErrors: number;
}
export interface ComparisonReport {
  suite: string;
  suiteSha256: string;
  atomProvider: string;
  wholeProvider: string;
  atom: ArmScore;
  whole: ArmScore;
  atomElapsedMs: number;
  wholeElapsedMs: number;
  /** Context item counts are not token counts. */
  atomContextItems: number;
  wholeContextItems: number;
  trials: ComparedTrial[];
  warning: string;
}

const choices = (c: BenchmarkCase): string[] =>
  c.type === "yesno" ? ["yes", "no", "unknown"] : [...(c.options ?? []), "unknown"];

function safeDistribution(value: unknown, allowed: string[]): { predicted: string; confidence: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid distribution");
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).length !== allowed.length || Object.keys(obj).some(k => !allowed.includes(k))) throw new Error("unexpected answer option");
  let sum = 0;
  for (const key of allowed) {
    if (typeof obj[key] !== "number" || !Number.isFinite(obj[key]) || obj[key] < 0) throw new Error("invalid probability");
    sum += obj[key] as number;
  }
  if (sum <= 0) throw new Error("zero probability distribution");
  const ranked = allowed.map(k => [k, (obj[k] as number) / sum] as const).sort((a,b) => b[1] - a[1]);
  return { predicted: ranked[0][0], confidence: ranked[0][1] };
}
/** Deliberately discard all exception strings: providers may include private source text in errors. */
function errorCode(error: unknown): FailureKind {
  const e = error as { name?: string; message?: string; status?: number };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "timeout";
  if (typeof e?.status === "number" || e?.name === "TypeError" ||
      /^whole-task HTTP error [0-9]+$/.test(e?.message ?? "")) return "transport";
  if (/probability|JSON|Syntax|invalid|missing or invalid|empty ollama|unapproved|unexpected|zero probability/i.test(e?.message ?? "")) return "invalid-response";
  return "other";
}

function score(trials: ComparedTrial[], arm: "atom" | "whole"): ArmScore {
  const valid = trials.filter(t => !!t[arm].predicted);
  const unknown = valid.filter(t => t.expected === "unknown");
  const wrong = valid.filter(t => t[arm].predicted !== t.expected);
  return {
    total: trials.length, valid: valid.length,
    correct: valid.filter(t => t[arm].predicted === t.expected).length,
    errors: trials.length - valid.length,
    accuracyOnValid: valid.length ? valid.filter(t => t[arm].predicted === t.expected).length / valid.length : null,
    correctUnknown: unknown.filter(t => t[arm].predicted === "unknown").length,
    expectedUnknown: trials.filter(t => t.expected === "unknown").length,
    unsupportedFalsePositives: unknown.filter(t => t[arm].predicted !== "unknown").length,
    highConfidenceErrors: wrong.filter(t => (t[arm].confidence ?? 0) >= 0.8).length,
  };
}

/** Identical cases, identical local evidence, but different information boundaries. */
export async function compareAtomVsWhole(
  atomProvider: ModelProvider, wholeProvider: WholeTaskProvider, suite: BenchmarkSuite,
): Promise<ComparisonReport> {
  validateBenchmarkSuite(suite);
  const questions: WholeTaskQuestion[] = suite.cases.map(c => ({
    // Neutral surrogate IDs: never send benchmark IDs (e.g. "missing-evidence") to the whole-task model.
    caseId: "q" + String(suite.cases.indexOf(c) + 1).padStart(4, "0"), question: c.question,
    ...(c.decision ? { decision: { ...c.decision } } : {}),
    options: choices(c),
    context: (() => { const snippets: string[] = []; let chars = 0; for (const handle of c.allowedSources) { for (const s of c.sources[handle]) { if (snippets.length >= 6 || chars >= 12000) return snippets; const clipped = s.slice(0, 12000 - chars); if (!clipped) return snippets; snippets.push(clipped); chars += clipped.length; } } return snippets; })(),
  }));
  const atomContextItems = questions.reduce((n, q) => n + q.context.length, 0);
  const trials: ComparedTrial[] = suite.cases.map(c => ({
    caseId: c.id, expected: c.expected, category: c.category,
    atom: { elapsedMs: 0 }, whole: {},
  }));

  // The worker interface is the only information boundary available to the atom model.
  // Run these first and record the measured wall time for the concurrent work.
  const atomStart = performance.now();
  const runAtom = async (c: BenchmarkCase, i: number): Promise<void> => {
    const atom: PackAtom = {
      id: "a.eval." + i, question: c.question, type: c.type,
      ...(c.decision ? { decision: { ...c.decision } } : {}),
      options: c.options, impact: c.impact ?? "low",
      worker: { sources: [...c.allowedSources], max_context_items: 6, max_context_chars: 12000 },
    };
    const t0 = performance.now();
    try {
      const result = await executeAtomWorker(atomProvider, atom, {}, {
        read: handle => {
          if (!c.allowedSources.includes(handle)) throw new Error("unauthorized source");
          return [...c.sources[handle]];
        },
      });
      trials[i].atom.predicted = result.value;
      trials[i].atom.confidence = result.probabilities[result.value];
    } catch (error) {
      trials[i].atom.error = errorCode(error);
      if (error instanceof OllamaOutputError) trials[i].atom.outputIssue = error.code;
    } finally {
      trials[i].atom.elapsedMs = Math.round(performance.now() - t0);
    }
  };
  // Bound parallelism so an 8-case benchmark does not overload a single local model.
  for (let i = 0; i < suite.cases.length; i += 2) {
    await Promise.all(suite.cases.slice(i, i + 2).map((c, j) => runAtom(c, i + j)));
  }
  const atomElapsedMs = Math.round(performance.now() - atomStart);

  const wholeStart = performance.now();
  try {
    // One explicit call sees ALL questions and allowed snippets. No production authority.
    const output = await wholeProvider.answerAll(structuredClone(questions));
    const expectedIds = new Set(questions.map(q => q.caseId));
    if (!output || typeof output !== "object" || Array.isArray(output) ||
      Object.keys(output).some(k => !expectedIds.has(k))) throw new Error("unexpected case IDs");
    for (let i = 0; i < suite.cases.length; i++) {
      try {
        const answer = safeDistribution(output[questions[i].caseId], choices(suite.cases[i]));
        trials[i].whole.predicted = answer.predicted;
        trials[i].whole.confidence = answer.confidence;
      } catch (error) {
        trials[i].whole.error = errorCode(error);
        if (error instanceof OllamaOutputError) trials[i].whole.outputIssue = error.code;
      }
    }
  } catch (error) {
    for (const trial of trials) {
      trial.whole.error = errorCode(error);
      if (error instanceof OllamaOutputError) trial.whole.outputIssue = error.code;
    }
  }
  const wholeElapsedMs = Math.round(performance.now() - wholeStart);

  return {
    suite: suite.id + "@" + suite.version,
    suiteSha256: createHash("sha256").update(JSON.stringify(suite)).digest("hex"),
    atomProvider: atomProvider.id, wholeProvider: wholeProvider.id,
    atom: score(trials, "atom"), whole: score(trials, "whole"),
    atomElapsedMs, wholeElapsedMs,
    atomContextItems, wholeContextItems: atomContextItems,
    trials,
    warning: "DEV EXPLORATION ONLY. Synthetic cases, different context boundaries, batch prompts, request counts and decoding budgets; these results cannot establish causal benefit or harm of worker isolation. Model confidence is uncalibrated. No authority promotion.",
  };
}

/** Ollama-backed, EVALUATOR-ONLY whole-task comparator. Never import into server workers. */
export function ollamaWholeTaskProvider(config: { model: string; host?: string; timeoutMs?: number }): WholeTaskProvider {
  const host = localOllamaHost(config.host);
  if (!config.model?.trim()) throw new Error("model required");
  const timeoutMs = config.timeoutMs ?? 120000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error("invalid timeout");
  return {
    id: "whole:ollama:" + config.model,
    async answerAll(questions) {
      const response = await fetch(host + "/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: config.model, stream: false,
          format: {
            type: "object",
            properties: Object.fromEntries(questions.map(q => [q.caseId, {
              type: "object",
              properties: Object.fromEntries(q.options.map(option => [option, { type: "number", minimum: 0 }])),
              required: [...q.options],
              additionalProperties: false,
            }])),
            required: questions.map(q => q.caseId),
            additionalProperties: false,
          },
          options: { temperature: 0, num_predict: 1200 },
          messages: [{ role: "user", content: JSON.stringify({
            instruction: "For each caseId, assess only that local question and its context. " + localDecisionInstruction(questions.some(q => q.decision?.kind === "verify-claim")) + " Return a JSON object keyed by caseId, with one nonnegative probability per allowed option. Do not emit any other text.",
            questions,
          }) }],
        }),
      });
      if (!response.ok) throw new Error("whole-task HTTP error " + response.status);
      const payload = await response.json() as { message?: { content?: string } };
      if (typeof payload.message?.content !== "string") throw new Error("empty whole-task response");
      const parsed: unknown = JSON.parse(payload.message.content);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid whole-task response");
      return parsed as Record<string, Record<string, number>>;
    },
  };
}

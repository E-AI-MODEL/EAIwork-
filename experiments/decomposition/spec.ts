export const KINDS = ["action", "prohibition", "condition", "approval", "uncertainty", "deadline"] as const;
export type Kind = (typeof KINDS)[number];
export type Task = { id: string; domain: string; text: string };
export type Gold = { id: string; spans: { kind: Kind; quote: string }[] };
export type Span = { kind: Kind; quote: string; start: number; end: number };
export type Candidate = { text: string; status: "hypothesis"; reason: string };
export type Prediction = { id: string; spans: Span[]; candidates: Candidate[]; failure?: string; calls?: number; elapsed_ms?: number; output_tokens?: number };
const VALID = new Set<string>(KINDS);

export function anchor(text: string, quote: string): { start: number; end: number } | null {
  if (!quote || !text.includes(quote)) return null;
  const start = text.indexOf(quote);
  if (start !== text.lastIndexOf(quote)) return null; // repeated source quote requires disambiguation
  return { start, end: start + quote.length };
}

export function validateFixtures(tasks: Task[], gold: Gold[]): string[] {
  const errors: string[] = [], ids = new Set<string>(), truth = new Map(gold.map(g => [g.id, g]));
  if (tasks.length !== 30 || gold.length !== 30) errors.push("v1 fixture must contain exactly 30 tasks and 30 gold records");
  if (truth.size !== gold.length) errors.push("duplicate gold id");
  for (const task of tasks) {
    if (ids.has(task.id)) errors.push(task.id + ": duplicate task id");
    ids.add(task.id);
    if (!task.domain || !task.text) errors.push(task.id + ": missing task domain/text");
    const g = truth.get(task.id);
    if (!g) { errors.push(task.id + ": missing gold"); continue; }
    const seen = new Set<string>();
    for (const span of g.spans) {
      if (!VALID.has(span.kind)) errors.push(task.id + ": unknown gold kind " + span.kind);
      if (!anchor(task.text, span.quote)) errors.push(task.id + ": missing or ambiguous gold quote " + span.quote);
      const key = span.kind + "\u0000" + span.quote;
      if (seen.has(key)) errors.push(task.id + ": duplicate gold span " + key);
      seen.add(key);
    }
  }
  for (const item of gold) if (!ids.has(item.id)) errors.push(item.id + ": gold missing task");
  return errors;
}

export function normalizeModelOutput(task: Task, raw: unknown): Prediction {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("model must return a JSON object");
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.spans)) throw new Error("model spans array missing");
  const spans: Span[] = [];
  for (const entry of data.spans) {
    if (!entry || typeof entry !== "object") throw new Error("invalid span");
    const e = entry as Record<string, unknown>;
    if (typeof e.kind !== "string" || !VALID.has(e.kind) || typeof e.quote !== "string") throw new Error("invalid kind/quote");
    const pos = anchor(task.text, e.quote);
    if (!pos) throw new Error("unanchored or ambiguous quote");
    spans.push({ kind: e.kind as Kind, quote: e.quote, ...pos });
  }
  const candidates: Candidate[] = [];
  if (data.candidates !== undefined) {
    if (!Array.isArray(data.candidates)) throw new Error("candidates must be an array");
    for (const rawCandidate of data.candidates) {
      if (!rawCandidate || typeof rawCandidate !== "object") throw new Error("invalid candidate");
      const c = rawCandidate as Record<string, unknown>;
      if (c.status !== "hypothesis" || typeof c.text !== "string" || !c.text.trim() ||
          typeof c.reason !== "string" || !c.reason.trim()) throw new Error("candidate must stay an explained hypothesis");
      candidates.push({ text: c.text, status: "hypothesis", reason: c.reason });
    }
  }
  const unique = new Set(spans.map(s => s.kind + "\u0000" + s.quote));
  if (unique.size !== spans.length) throw new Error("duplicate kind+quote");
  return { id: task.id, spans, candidates };
}

export function validatePrediction(task: Task, row: Prediction): string[] {
  const errors: string[] = [];
  if (row.id !== task.id) errors.push("case id mismatch");
  if (!Array.isArray(row.spans) || !Array.isArray(row.candidates)) return [...errors, "missing spans/candidates array"];
  const seen = new Set<string>();
  for (const s of row.spans) {
    if (!VALID.has(s.kind) || !Number.isInteger(s.start) || !Number.isInteger(s.end) ||
        s.start < 0 || s.end <= s.start || task.text.slice(s.start, s.end) !== s.quote) errors.push("invalid source-anchored span");
    const key = s.kind + "\u0000" + s.quote;
    if (seen.has(key)) errors.push("duplicate span");
    seen.add(key);
  }
  for (const c of row.candidates) {
    if (c.status !== "hypothesis" || !c.text?.trim() || !c.reason?.trim()) errors.push("hypothesis promoted or malformed");
  }
  return errors;
}
export function consensus(task: Task, a: Prediction, b: Prediction): Prediction {
  const second = new Set(b.spans.map(s => s.kind + "\u0000" + s.quote));
  const spans = a.spans.filter(s => second.has(s.kind + "\u0000" + s.quote));
  return { id: task.id, spans, candidates: [] };
}
const ratio = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;
export function scoreRun(tasks: Task[], gold: Gold[], predictions: Prediction[]) {
  const valid = validateFixtures(tasks, gold);
  if (valid.length) throw new Error("broken fixture: " + valid.join("; "));
  const taskById = new Map(tasks.map(t => [t.id, t]));
  const predById = new Map<string, Prediction>();
  for (const p of predictions) {
    if (predById.has(p.id)) throw new Error("duplicate prediction: " + p.id);
    if (!taskById.has(p.id)) throw new Error("unknown prediction: " + p.id);
    predById.set(p.id, p);
  }
  if (predById.size !== tasks.length) throw new Error("one prediction required per task");
  const goldById = new Map(gold.map(g => [g.id, g]));
  let tp = 0, fp = 0, fn = 0, validCases = 0, failedCases = 0, elapsed_ms = 0, calls = 0, output_tokens = 0;
  const byKind: Record<string, { tp: number; fp: number; fn: number }> =
    Object.fromEntries(KINDS.map(kind => [kind, { tp: 0, fp: 0, fn: 0 }]));
  const cases = tasks.map(task => {
    const p = predById.get(task.id)!;
    elapsed_ms += p.elapsed_ms || 0; calls += p.calls || 0; output_tokens += p.output_tokens || 0;
    const issues = p.failure ? [p.failure] : validatePrediction(task, p);
    if (issues.length) { failedCases++; return { id: task.id, valid: false, issues }; }
    validCases++;
    const expected = new Set(goldById.get(task.id)!.spans.map(s => s.kind + "\u0000" + s.quote));
    const actual = new Set(p.spans.map(s => s.kind + "\u0000" + s.quote));
    for (const k of actual) {
      const kind = k.split("\u0000", 1)[0]; 
      if (expected.has(k)) { tp++; byKind[kind].tp++; } else { fp++; byKind[kind].fp++; }
    }
    for (const k of expected) if (!actual.has(k)) { fn++; byKind[k.split("\u0000", 1)[0]].fn++; }
    return { id: task.id, valid: true, expected: expected.size, predicted: actual.size,
      matched: [...actual].filter(k => expected.has(k)).length, hypotheses: p.candidates.length };
  });
  const expectedTotal = gold.reduce((n, g) => n + g.spans.length, 0);
  // Invalid runs are not scored as zero correctness: report their coverage separately.
  const metrics = Object.fromEntries(Object.entries(byKind).map(([kind, v]) =>
    [kind, { ...v, recall: ratio(v.tp, v.tp + v.fn), precision: ratio(v.tp, v.tp + v.fp) }]));
  return { contract: "dev-span-anchor-v1", dataset: "30 publicly inspectable synthetic DEV tasks",
    casesTotal: tasks.length, validCases, failedCases,
    expectedGoldSpans: expectedTotal, coveredGoldSpans: tp + fn,
    matchedSpans: tp, falsePositiveSpans: fp, missedSpansInValidCases: fn,
    precisionOnValid: ratio(tp, tp + fp), recallOnValid: ratio(tp, tp + fn),
    coverageOfGold: ratio(tp + fn, expectedTotal),
    total_calls: calls, elapsed_ms, output_tokens,
    byKind: metrics, cases,
    caveat: "Exact anchored-span proxy only: semantic correctness, causality, dependency structure and evidence authority require blind human adjudication. Do not compare arms if transport validity or token budgets differ." };
}

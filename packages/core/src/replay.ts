import { createHash } from "node:crypto";
import type { EaiEvent, State } from "./types.ts";
import { validate } from "./validate.ts";
import { deriveAll } from "./derive.ts";

export function apply(state: State, e: EaiEvent): State {
  const previous = state[e.atom] ?? { evidence: [], flags: [], lowered: [] };
  const a = structuredClone(previous);
  const s: State = { ...state, [e.atom]: a };
  switch (e.type) {
    case "answer.proposed":
      // Evidence and lowered-confidence reasons belong to one answer value. A new value starts clean.
      if (a.value !== undefined && a.value !== e.value) { a.evidence = []; a.lowered = []; }
      a.value = e.value;
      a.answeredBy = e.actor;
      a.answerBasis = e.basis;
      a.probabilities = e.probabilities;
      break;
    case "evidence.attached": a.evidence.push({ ...e.evidence, attached_at: e.at }); break;
    case "check.passed":
    case "check.failed":
      // A deterministic check has one current verdict: its latest run replaces its earlier ones.
      a.evidence = a.evidence.filter((x) => !(x.observer.kind === "check" && x.lineage === e.evidence.lineage));
      a.evidence.push({ ...e.evidence, attached_at: e.at });
      break;
    case "confidence.lowered": a.lowered.push(e.reason); break;
    case "flag.raised": a.flags.push({ id: e.id, message: e.message, by: e.actor }); break;
    case "flag.dismissed": { const f = a.flags.find((x) => x.id === e.flag); if (f) f.dismissed = true; break; }
  }
  return s;
}

export function replay(events: EaiEvent[], now: string, validForDays: Record<string, number> = {}) {
  let state: State = {};
  const rejected: { index: number; id: string; reason: string }[] = [];
  events.forEach((e, index) => {
    const v = validate(e, state);
    if (v.ok) state = apply(state, e);
    else rejected.push({ index, id: e?.id ?? `index-${index}`, reason: v.reason });
  });
  const derived = deriveAll(state, now, validForDays);
  const checksum = createHash("sha256")
    .update(JSON.stringify(Object.entries(derived).map(([k, d]) => [k, d.status]).sort()))
    .digest("hex");
  return { state, derived, rejected, checksum };
}

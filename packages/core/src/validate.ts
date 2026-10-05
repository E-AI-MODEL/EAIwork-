import type { EaiEvent, State } from "./types.ts";

export type Verdict = { ok: true } | { ok: false; reason: string };
const no = (reason: string): Verdict => ({ ok: false, reason });

/** The one gate every event passes. Runs in the client, the gateway and CI. */
export function validate(e: EaiEvent, state: State): Verdict {
  if (e.type === "status.raised") {
    if (e.actor.kind === "model") return no("model cannot raise status");
    return no("status is derived from evidence; attach evidence instead");
  }
  if (e.type === "check.passed") {
    if (e.actor.kind !== "check") return no("check.passed must come from a check runner");
    if (e.evidence.deterministic !== true) return no("check must be deterministic (non-LLM)");
  }
  if (e.type === "evidence.attached" && e.actor.kind === "model" && e.evidence.observer.kind !== "model") {
    return no("model cannot attach evidence under another observer");
  }
  if (e.type === "evidence.attached" && e.evidence.observer.id !== e.actor.id) {
    return no("evidence observer must match the actor");
  }
  if (e.type === "flag.dismissed" && e.actor.kind === "model") return no("only a person dismisses flags");
  if (e.type === "confidence.lowered" && !e.reason) return no("lowering confidence needs a reason");
  if (e.type !== "answer.proposed" && !(e.atom in state)) return no(`unknown atom ${e.atom}`);
  return { ok: true };
}

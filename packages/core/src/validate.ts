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
    if (e.evidence.observer.kind !== "check" || e.evidence.observer.id !== e.actor.id) {
      return no("check evidence observer must match the check runner");
    }
    if (e.evidence.deterministic !== true) return no("check must be deterministic (non-LLM)");
  }
  if (e.type === "evidence.attached") {
    if (e.evidence.observer.kind !== e.actor.kind || e.evidence.observer.id !== e.actor.id) {
      return no("evidence observer must match the actor kind and id");
    }
    if (e.actor.kind === "check") return no("check evidence must use check.passed");
  }
  if (e.type === "flag.dismissed" && e.actor.kind !== "person") return no("only a person dismisses flags");
  if (e.type === "confidence.lowered" && !e.reason) return no("lowering confidence needs a reason");
  if (e.type !== "answer.proposed" && !(e.atom in state)) return no(`unknown atom ${e.atom}`);
  return { ok: true };
}

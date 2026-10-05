import type { ActorKind, EaiEvent, State } from "./types.ts";

export type Verdict = { ok: true } | { ok: false; reason: string };
const no = (reason: string): Verdict => ({ ok: false, reason });

const KNOWN_TYPES = new Set([
  "answer.proposed", "evidence.attached", "check.passed", "confidence.lowered",
  "flag.raised", "flag.dismissed", "status.raised",
]);
const ACTOR_KINDS = new Set<ActorKind>(["person", "system", "model", "check"]);
const ALLOWED: Record<ActorKind, Set<string>> = {
  model: new Set(["answer.proposed", "confidence.lowered", "flag.raised"]),
  person: new Set(["answer.proposed", "evidence.attached", "flag.raised", "flag.dismissed"]),
  system: new Set(["answer.proposed", "evidence.attached", "flag.raised"]),
  check: new Set(["check.passed"]),
};

/** The one gate every event passes. Public HTTP ingestion applies an additional server-side trust boundary. */
export function validate(e: EaiEvent | any, state: State): Verdict {
  if (!e || typeof e !== "object" || !KNOWN_TYPES.has(e.type)) return no("unknown event type");
  if (!e.actor || !ACTOR_KINDS.has(e.actor.kind) || typeof e.actor.id !== "string" || typeof e.atom !== "string") {
    return no("malformed event");
  }

  if (e.type === "status.raised") {
    if (e.actor.kind === "model") return no("model cannot raise status");
    return no("status is derived from evidence; attach evidence instead");
  }

  if (!ALLOWED[e.actor.kind as ActorKind].has(e.type)) return no(`${e.actor.kind} cannot emit ${e.type}`);

  if (e.type === "check.passed") {
    if (!e.evidence || typeof e.evidence !== "object") return no("check.passed needs evidence");
    if (e.evidence.observer?.kind !== "check" || e.evidence.observer?.id !== e.actor.id) {
      return no("check evidence observer must match the check runner");
    }
    if (e.evidence.deterministic !== true) return no("check must be deterministic (non-LLM)");
  }

  if (e.type === "evidence.attached") {
    if (!e.evidence || typeof e.evidence !== "object") return no("evidence.attached needs evidence");
    if (e.evidence.observer?.kind !== e.actor.kind || e.evidence.observer?.id !== e.actor.id) {
      return no("evidence observer must match the actor kind and id");
    }
  }

  if (e.type === "confidence.lowered" && !e.reason) return no("lowering confidence needs a reason");
  if (e.type !== "answer.proposed" && !(e.atom in state)) return no(`unknown atom ${e.atom}`);
  return { ok: true };
}

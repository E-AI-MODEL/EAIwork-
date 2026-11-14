export const LADDER = ["unknown", "assumption", "claim", "observed", "checked", "proven"] as const;
export type Status = (typeof LADDER)[number];
export type ActorKind = "person" | "system" | "model" | "check";

export interface Actor { kind: ActorKind; id: string }

/** What a deterministic check relied on when it passed. The check only supports while this still holds. */
export interface CheckBasis {
  /** Atom values the check read, as they were when it ran. */
  reads: Record<string, string | null>;
  /** Registered sources the check consulted outside the atom state. */
  sources?: string[];
}

/** What a model worker was given when it proposed an answer. Provenance, never support. */
export interface AnswerBasis {
  reads: Record<string, string | null>;
  sources: string[];
  /** SHA-256 of the exact capsule the model received. */
  capsuleSha256: string;
}

export interface Evidence {
  id: string;
  source: string;
  observer: Actor;
  mode: "reported" | "observed"; // reported = someone says so, observed = seen first-hand
  lineage: string;               // origin id; same lineage = same origin = not independent
  source_ref?: string;           // registered source the lineage was derived from
  origin_unverified?: boolean;   // no registered source: can support, cannot corroborate
  basis?: CheckBasis;            // set on check evidence by the server
  supports: boolean;             // false = contradicts the value
  valid_until?: string;          // ISO date
  deterministic?: boolean;       // set on check evidence
  attached_at?: string;          // set by the core when the event is applied
}

export type EaiEvent =
  | { id: string; at: string; actor: Actor; type: "answer.proposed"; atom: string; value: string; probabilities?: Record<string, number>; basis?: AnswerBasis }
  | { id: string; at: string; actor: Actor; type: "evidence.attached"; atom: string; evidence: Evidence }
  | { id: string; at: string; actor: Actor; type: "check.passed"; atom: string; evidence: Evidence }
  | { id: string; at: string; actor: Actor; type: "check.failed"; atom: string; evidence: Evidence }
  | { id: string; at: string; actor: Actor; type: "confidence.lowered"; atom: string; reason: string }
  | { id: string; at: string; actor: Actor; type: "flag.raised"; atom: string; message: string }
  | { id: string; at: string; actor: Actor; type: "flag.dismissed"; atom: string; flag: string; reason: string }
  | { id: string; at: string; actor: Actor; type: "status.raised"; atom: string; to: Status };

export interface AtomState {
  value?: string;
  /** Who proposed the current answer. Provenance only; never an input to status. */
  answeredBy?: Actor;
  /** What a model worker was given for the current answer. Absent for answers typed by a person. */
  answerBasis?: AnswerBasis;
  evidence: Evidence[];
  flags: { id: string; message: string; by: Actor; dismissed?: boolean }[];
  lowered: string[];
  probabilities?: Record<string, number>;
}
export type State = Record<string, AtomState>;

export interface Derived {
  status: Status;
  /** The rule that produced the status. Every status has exactly one. */
  rule: string;
  /** Evidence ids that carry the status under that rule. Empty below `claim`. */
  basis: string[];
  reasons: string[];
  expired: string[];
  /** Check evidence whose recorded inputs no longer match the current state. */
  stale: string[];
  /** What would justify the next status. Empty at `proven`. */
  next: string;
}

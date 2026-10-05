export const LADDER = ["unknown", "assumption", "claim", "observed", "checked", "proven"] as const;
export type Status = (typeof LADDER)[number];
export type ActorKind = "person" | "system" | "model" | "check";

export interface Actor { kind: ActorKind; id: string }

export interface Evidence {
  id: string;
  source: string;
  observer: Actor;
  mode: "reported" | "observed"; // reported = someone says so, observed = seen first-hand
  lineage: string;               // origin chain id; same lineage = not independent
  supports: boolean;             // false = contradicts the value
  valid_until?: string;          // ISO date
  deterministic?: boolean;       // set on check evidence
  attached_at?: string;          // set by the core when the event is applied
}

export type EaiEvent =
  | { id: string; at: string; actor: Actor; type: "answer.proposed"; atom: string; value: string; probabilities?: Record<string, number> }
  | { id: string; at: string; actor: Actor; type: "evidence.attached"; atom: string; evidence: Evidence }
  | { id: string; at: string; actor: Actor; type: "check.passed"; atom: string; evidence: Evidence }
  | { id: string; at: string; actor: Actor; type: "confidence.lowered"; atom: string; reason: string }
  | { id: string; at: string; actor: Actor; type: "flag.raised"; atom: string; message: string }
  | { id: string; at: string; actor: Actor; type: "flag.dismissed"; atom: string; flag: string; reason: string }
  | { id: string; at: string; actor: Actor; type: "status.raised"; atom: string; to: Status };

export interface AtomState {
  value?: string;
  evidence: Evidence[];
  flags: { id: string; message: string; by: Actor; dismissed?: boolean }[];
  lowered: string[];
  probabilities?: Record<string, number>;
}
export type State = Record<string, AtomState>;

export interface Derived { status: Status; reasons: string[]; expired: string[] }

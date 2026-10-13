import { optionsFor, route, temperatureScale } from "../../core/src/index.ts";
import type { Pack, PackAtom, Route, State } from "../../core/src/index.ts";
import { observeLocalEvidence, type EvidenceObservationResult } from "../../evidence/src/observe.ts";

export interface AtomCapsule {
  /** The model sees no atom id, cluster, pack, project goal, status, evidence or downstream use. */
  question: string;
  /** Present only for atom-local claim verification; not a project-wide prompt. */
  decision?: { kind: "verify-claim"; claim: string };
  options: string[];
  inputs: Record<string, string | null>;
  context: string[];
}

export interface SourceBroker {
  /** Resolve exactly one opaque handle. The broker does not receive the pack or the target atom. */
  read(handle: string): Promise<string[]> | string[];
}

/** Untrusted, local excerpt coordinates. No repository or source handles reach the model. */
export interface LocalReferenceProposal {
  contextIndex: number;
  start: number;
  end: number;
  quote: string;
}

export interface ModelProposal {
  probabilities: Record<string, number>;
  /** Optional proposed text anchors. Empty means the model found no anchor. */
  references: LocalReferenceProposal[];
}

export interface ModelSession {
  /** Legacy and default path: available on every provider. */
  answer(capsule: AtomCapsule): Promise<Record<string, number>>;
  /** Optional capability: richer models can provide references without changing the default path. */
  propose?(capsule: AtomCapsule): Promise<ModelProposal>;
  close?(): Promise<void> | void;
}

/** Any model, any vendor. A fresh single-use session is opened for every atom execution. */
export interface ModelProvider {
  id: string; // e.g. "model:acme-v3"
  openSession(): Promise<ModelSession> | ModelSession;
}

export type EvidenceSidecar =
  | { status: "provider-unsupported" }
  | { status: "observed"; observation: EvidenceObservationResult };

export interface WorkerResult {
  providerId: string;
  value: string;
  /** Existing provisional response route; evidence proposals do not grant authority. */
  route: Route;
  probabilities: Record<string, number>;
  /** Present only when opt-in observation was requested. Never an evidence attachment. */
  evidence?: EvidenceSidecar;
}

const boundedContext = async (
  handles: string[],
  broker: SourceBroker,
  maxItems: number,
  maxChars: number,
): Promise<string[]> => {
  const result: string[] = [];
  let chars = 0;
  for (const handle of handles) {
    const snippets = await broker.read(handle);
    for (const raw of snippets) {
      if (result.length >= maxItems || chars >= maxChars) return result;
      const text = String(raw);
      const remaining = maxChars - chars;
      const clipped = text.slice(0, remaining);
      if (!clipped) return result;
      result.push(clipped);
      chars += clipped.length;
    }
  }
  return result;
};

export async function buildAtomCapsule(
  atom: PackAtom,
  state: State,
  broker: SourceBroker,
): Promise<AtomCapsule> {
  const policy = atom.worker ?? {};
  const inputs = Object.fromEntries(
    (policy.reads ?? []).map((read) => [read.as, state[read.atom]?.value ?? null]),
  );
  const context = await boundedContext(
    policy.sources ?? [],
    broker,
    policy.max_context_items ?? 6,
    policy.max_context_chars ?? 12_000,
  );
  return {
    question: atom.question,
    ...(atom.decision ? { decision: { kind: atom.decision.kind, claim: atom.decision.claim } } : {}),
    options: optionsFor(atom),
    inputs,
    context,
  };
}

export async function executeAtomWorker(
  provider: ModelProvider,
  atom: PackAtom,
  state: State,
  broker: SourceBroker,
  opts: { temperature?: number; observeEvidence?: boolean } = {},
): Promise<WorkerResult> {
  const capsule = await buildAtomCapsule(atom, state, broker);
  const session = await provider.openSession();
  let raw: Record<string, number>;
  let proposal: ModelProposal | undefined;
  try {
    if (opts.observeEvidence && session.propose) {
      // The model sees only a fresh, bounded capsule. No source handles or sibling context.
      proposal = await session.propose(structuredClone(capsule));
      if (!proposal || typeof proposal !== "object" ||
          !proposal.probabilities || typeof proposal.probabilities !== "object" ||
          !Array.isArray(proposal.references)) {
        throw new Error("Invalid structured proposal");
      }
      raw = proposal.probabilities;
    } else {
      raw = await session.answer(structuredClone(capsule));
    }
  } finally {
    await session.close?.();
  }

  // Keep only allowed options; anything else the model invents is dropped.
  let p: Record<string, number> = {};
  for (const option of capsule.options) p[option] = Math.max(0, Number(raw[option]) || 0);
  const sum = Object.values(p).reduce((a, b) => a + b, 0);
  p = sum > 0
    ? Object.fromEntries(Object.entries(p).map(([key, value]) => [key, value / sum]))
    : { ...Object.fromEntries(capsule.options.map((option) => [option, 0])), unknown: 1 };
  if (opts.temperature) p = temperatureScale(p, opts.temperature);

  const value = Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];
  let evidence: EvidenceSidecar | undefined;
  if (opts.observeEvidence) {
    if (!proposal) {
      evidence = { status: "provider-unsupported" };
    } else {
      const sources = capsule.context.map((content, i) => ({
        handle: "local." + i, content,
      }));
      const proposedReferences = proposal.references.map((ref) => ({
        handle: Number.isSafeInteger(ref?.contextIndex) ?
          "local." + ref.contextIndex : "invalid-local-index",
        start: ref?.start, end: ref?.end, quote: ref?.quote,
      }));
      evidence = {
        status: "observed",
        observation: observeLocalEvidence({
          claim: capsule.decision?.claim ?? capsule.question,
          answer: value === "yes" || value === "no" ? value : "unknown",
          authorizedHandles: sources.map(s => s.handle),
          sources,
          proposedReferences,
          // Trusted policy comes from the atom, not from the model response.
          policy: { impact: atom.impact ?? "low" },
        }),
      };
    }
  }
  return {
    providerId: provider.id,
    value,
    route: route(p, atom.impact ?? "low"),
    probabilities: p,
    ...(evidence ? { evidence } : {}),
  };
}

/** Deterministic stand-in for tests and demos. The provider only receives the isolated capsule. */
export const mockProvider = (
  id: string,
  answer: Record<string, number> | ((capsule: AtomCapsule) => Record<string, number>),
): ModelProvider => ({
  id,
  openSession: () => ({
    answer: async (capsule) => typeof answer === "function" ? answer(capsule) : answer,
  }),
});

/** Helper for runtimes that need to validate worker policies against a whole pack without exposing it to a model. */
export const workerAtom = (pack: Pack, atomId: string) => pack.atoms.find((atom) => atom.id === atomId);

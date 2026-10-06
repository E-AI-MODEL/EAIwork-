import { optionsFor, route, temperatureScale } from "../../core/src/index.ts";
import type { EaiEvent, Pack, PackAtom, Route, State } from "../../core/src/index.ts";

export interface AtomCapsule {
  /** The model sees no atom id, cluster, pack, project goal, status, evidence or downstream use. */
  question: string;
  options: string[];
  inputs: Record<string, string | null>;
  context: string[];
}

export interface SourceBroker {
  /** Resolve exactly one opaque handle. The broker does not receive the pack or the target atom. */
  read(handle: string): Promise<string[]> | string[];
}

/** Any model, any vendor: one capsule in, probabilities over fixed options out. */
export interface ModelProvider {
  id: string; // e.g. "model:acme-v3"
  answer(capsule: AtomCapsule): Promise<Record<string, number>>;
}

export interface AskResult {
  event: EaiEvent;
  route: Route;
  probabilities: Record<string, number>;
  capsule: AtomCapsule;
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
  opts: { temperature?: number; at: string; eventId: string },
): Promise<AskResult> {
  const capsule = await buildAtomCapsule(atom, state, broker);
  const raw = await provider.answer(structuredClone(capsule));

  // Keep only allowed options; anything else the model invents is dropped.
  let p: Record<string, number> = {};
  for (const option of capsule.options) p[option] = Math.max(0, Number(raw[option]) || 0);
  const sum = Object.values(p).reduce((a, b) => a + b, 0);
  p = sum > 0
    ? Object.fromEntries(Object.entries(p).map(([key, value]) => [key, value / sum]))
    : { ...Object.fromEntries(capsule.options.map((option) => [option, 0])), unknown: 1 };
  if (opts.temperature) p = temperatureScale(p, opts.temperature);

  const value = Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];
  const event: EaiEvent = {
    id: opts.eventId,
    at: opts.at,
    actor: { kind: "model", id: provider.id },
    type: "answer.proposed",
    atom: atom.id,
    value,
    probabilities: p,
  };
  return { event, route: route(p, atom.impact ?? "low"), probabilities: p, capsule };
}

/** Deterministic stand-in for tests and demos. The provider only receives the isolated capsule. */
export const mockProvider = (
  id: string,
  answer: Record<string, number> | ((capsule: AtomCapsule) => Record<string, number>),
): ModelProvider => ({
  id,
  answer: async (capsule) => typeof answer === "function" ? answer(capsule) : answer,
});

/** Helper for runtimes that need to validate worker policies against a whole pack without exposing it to a model. */
export const workerAtom = (pack: Pack, atomId: string) => pack.atoms.find((atom) => atom.id === atomId);

import { optionsFor, route, temperatureScale } from "../../core/src/index.ts";
import type { PackAtom, EaiEvent, Route } from "../../core/src/index.ts";

/** Any model, any vendor: one atom in, probabilities over fixed options out. */
export interface ModelProvider {
  id: string; // e.g. "model:acme-v3"
  answer(req: { atom: string; question: string; options: string[]; context_refs: string[] }): Promise<Record<string, number>>;
}

export interface AskResult { event: EaiEvent; route: Route; probabilities: Record<string, number> }

export async function ask(
  provider: ModelProvider, atom: PackAtom,
  opts: { context_refs?: string[]; temperature?: number; at: string; eventId: string },
): Promise<AskResult> {
  const options = optionsFor(atom);
  const raw = await provider.answer({ atom: atom.id, question: atom.question, options, context_refs: opts.context_refs ?? [] });
  // Keep only allowed options; anything else the model invents is dropped.
  let p: Record<string, number> = {};
  for (const o of options) p[o] = Math.max(0, Number(raw[o]) || 0);
  const sum = Object.values(p).reduce((a, b) => a + b, 0);
  p = sum > 0 ? Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v / sum])) : { ...Object.fromEntries(options.map((o) => [o, 0])), unknown: 1 };
  if (opts.temperature) p = temperatureScale(p, opts.temperature);
  const value = Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];
  const event: EaiEvent = {
    id: opts.eventId, at: opts.at, actor: { kind: "model", id: provider.id },
    type: "answer.proposed", atom: atom.id, value, probabilities: p,
  };
  return { event, route: route(p, atom.impact ?? "low"), probabilities: p };
}

/** Deterministic stand-in for tests and demos. Replace with a real provider; the interface stays the same. */
export const mockProvider = (id: string, table: Record<string, Record<string, number>>): ModelProvider => ({
  id, answer: async (req) => table[req.atom] ?? { unknown: 1 },
});

import { optionsFor } from "../../core/src/index.ts";
import type { PackAtom, EaiEvent } from "../../core/src/index.ts";

/** Any model, any vendor: one atom in, one fixed-option answer out. */
export interface ModelProvider {
  id: string; // e.g. "model:acme-v3"
  answer(req: { atom: string; question: string; options: string[]; context_refs: string[] }): Promise<string>;
}

export interface AskResult { event: EaiEvent }

export async function ask(
  provider: ModelProvider, atom: PackAtom,
  opts: { context_refs?: string[]; at: string; eventId: string },
): Promise<AskResult> {
  const options = optionsFor(atom);
  const raw = await provider.answer({
    atom: atom.id,
    question: atom.question,
    options,
    context_refs: opts.context_refs ?? [],
  });
  const value = options.includes(raw) ? raw : "unknown";
  const event: EaiEvent = {
    id: opts.eventId,
    at: opts.at,
    actor: { kind: "model", id: provider.id },
    type: "answer.proposed",
    atom: atom.id,
    value,
  };
  return { event };
}

/** Deterministic stand-in for tests and demos. Replace with a real provider; the interface stays the same. */
export const mockProvider = (id: string, table: Record<string, string>): ModelProvider => ({
  id,
  answer: async (req) => table[req.atom] ?? "unknown",
});

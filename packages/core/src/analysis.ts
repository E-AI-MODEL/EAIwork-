import type { Derived, State, Status } from "./types.ts";
import { LADDER } from "./types.ts";
import { rank } from "./derive.ts";
import type { Pack } from "./pack.ts";

type D = Record<string, Derived>;
const st = (d: D, id: string): Status => d[id]?.status ?? "unknown";

/** Distribution over the ladder per cluster. Deliberately no single score. */
export function distribution(p: Pack, d: D) {
  return Object.fromEntries(p.clusters.map((c) => {
    const counts = Object.fromEntries(LADDER.map((s) => [s, 0])) as Record<Status, number>;
    for (const id of c.atoms) counts[st(d, id)]++;
    return [c.id, counts];
  }));
}

/** An atom answered above "assumption" whose prerequisite is at "assumption" or lower is shaky. */
export function propagate(p: Pack, d: D) {
  const out: { atom: string; because: string; message: string }[] = [];
  for (const a of p.atoms) for (const dep of a.depends_on ?? []) {
    if (rank(st(d, a.id)) > rank("assumption") && rank(st(d, dep)) <= rank("assumption")) {
      out.push({ atom: a.id, because: dep, message: `${a.id} is ${st(d, a.id)} but its prerequisite ${dep} is ${st(d, dep)}` });
    }
  }
  return out;
}

/** For goal atoms: the atom plus everything it depends on (transitively), lowest status first. */
export function weakestLink(p: Pack, d: D, goals: string[]) {
  const byId = new Map(p.atoms.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const walk = (id: string) => { if (seen.has(id)) return; seen.add(id); (byId.get(id)?.depends_on ?? []).forEach(walk); };
  goals.forEach(walk);
  return [...seen]
    .map((id) => ({ atom: id, status: st(d, id), question: byId.get(id)?.question ?? "" }))
    .sort((x, y) => rank(x.status) - rank(y.status) || x.atom.localeCompare(y.atom));
}

/** Prompts for human review. Never a verdict that the pack is complete. */
export function coverage(p: Pack, state: State, d: D) {
  const sizes = p.clusters.map((c) => c.atoms.length).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  const notes: string[] = [];
  for (const c of p.clusters) {
    if (median >= 4 && c.atoms.length < median / 2) notes.push(`cluster ${c.id} has ${c.atoms.length} atoms against a median of ${median}: possibly too thin`);
    const lineages = new Set<string>();
    let withEvidence = 0;
    for (const id of c.atoms) {
      const ev = (state[id]?.evidence ?? []).filter((e) => e.observer.kind !== "model");
      if (ev.length) withEvidence++;
      ev.forEach((e) => lineages.add(e.lineage));
    }
    if (withEvidence >= 3 && lineages.size === 1) notes.push(`cluster ${c.id}: all evidence traces to one origin`);
    const unknown = c.atoms.filter((id) => st(d, id) === "unknown").length;
    if (c.atoms.length && unknown / c.atoms.length >= 0.8) notes.push(`cluster ${c.id}: ${unknown} of ${c.atoms.length} atoms unanswered`);
  }
  return { notes, disclaimer: "Prompts for review, not a guarantee of completeness." };
}

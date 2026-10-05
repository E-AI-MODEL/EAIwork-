export interface PackAtom {
  id: string; question: string; type: "yesno" | "choice" | "score";
  options?: string[]; depends_on?: string[]; valid_for_days?: number; impact?: "low" | "high";
}
export interface Pack {
  pack: string; version: string; domain?: string;
  clusters: { id: string; title: string; atoms: string[] }[];
  atoms: PackAtom[];
  rules?: any[];
}

/** Returns a list of problems; empty list = pack is structurally sound. */
export function lintPack(p: Pack): string[] {
  const err: string[] = [];
  const ids = new Set<string>();
  for (const a of p.atoms ?? []) {
    if (!/^a\.[a-z0-9.]+$/.test(a.id)) err.push(`atom id "${a.id}" does not match ^a\\.[a-z0-9.]+$`);
    if (ids.has(a.id)) err.push(`duplicate atom id ${a.id}`);
    ids.add(a.id);
    if (!a.question?.trim()) err.push(`${a.id}: empty question`);
    if (!["yesno", "choice", "score"].includes(a.type)) err.push(`${a.id}: unknown type ${a.type}`);
    if (a.type === "choice" && (!a.options || a.options.length < 2)) err.push(`${a.id}: choice needs at least 2 options`);
    if (a.valid_for_days !== undefined && !(a.valid_for_days > 0)) err.push(`${a.id}: valid_for_days must be > 0`);
  }
  for (const a of p.atoms ?? []) for (const d of a.depends_on ?? []) {
    if (!ids.has(d)) err.push(`${a.id}: depends_on unknown atom ${d}`);
    if (d === a.id) err.push(`${a.id}: depends on itself`);
  }
  const inCluster = new Map<string, string>();
  for (const c of p.clusters ?? []) for (const id of c.atoms) {
    if (!ids.has(id)) err.push(`cluster ${c.id}: unknown atom ${id}`);
    if (inCluster.has(id)) err.push(`atom ${id} is in two clusters (${inCluster.get(id)}, ${c.id})`);
    inCluster.set(id, c.id);
  }
  for (const id of ids) if (!inCluster.has(id)) err.push(`atom ${id} is in no cluster`);
  // cycle check (depth-first)
  const deps = new Map<string, string[]>();
  for (const a of p.atoms ?? []) deps.set(a.id, [...(deps.get(a.id) ?? []), ...(a.depends_on ?? [])]);
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { err.push(`dependency cycle: ${[...path, id].join(" -> ")}`); return; }
    state.set(id, 1);
    for (const d of deps.get(id) ?? []) if (ids.has(d)) visit(d, [...path, id]);
    state.set(id, 2);
  };
  for (const id of ids) visit(id, []);
  // rules may only name known atoms
  const walk = (c: any): string[] => !c ? [] : c.all ? c.all.flatMap(walk) : c.any ? c.any.flatMap(walk) : c.not ? walk(c.not) : c.atom ? [c.atom] : [];
  for (const r of p.rules ?? []) for (const a of walk(r.when)) if (!ids.has(a)) err.push(`rule ${r.id}: unknown atom ${a}`);
  return err;
}

export const optionsFor = (a: PackAtom): string[] =>
  a.type === "yesno" ? ["yes", "no", "unknown"]
  : a.type === "score" ? ["1", "2", "3", "4", "5", "unknown"]
  : [...(a.options ?? []), "unknown"];

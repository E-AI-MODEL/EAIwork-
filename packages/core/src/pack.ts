import { LADDER } from "./types.ts";

export interface PackSource {
  id: string;
}

export interface WorkerRead {
  atom: string;
  as: string;
}

export interface AtomWorkerPolicy {
  /** Only declared dependencies may be read by the worker. Values only; no status/evidence. */
  reads?: WorkerRead[];
  /** Opaque source handles resolved by the server-side broker. Handles are never shown to the model. */
  sources?: string[];
  /** Hard-bounded context window controls. */
  max_context_items?: number;
  max_context_chars?: number;
}

export interface PackAtom {
  id: string;
  question: string;
  type: "yesno" | "choice" | "score";
  options?: string[];
  depends_on?: string[];
  valid_for_days?: number;
  impact?: "low" | "high";
  worker?: AtomWorkerPolicy;
}

export interface Pack {
  pack: string;
  version: string;
  domain?: string;
  sources?: PackSource[];
  clusters: { id: string; title: string; atoms: string[] }[];
  atoms: PackAtom[];
  rules?: any[];
}

const MAX_CONTEXT_ITEMS = 12;
const MAX_CONTEXT_CHARS = 24_000;

/** Returns a list of problems; empty list = pack is structurally sound. */
export function lintPack(p: Pack): string[] {
  const err: string[] = [];
  const ids = new Set<string>();
  const sourceIds = new Set<string>();

  for (const source of p.sources ?? []) {
    if (!/^s\.[a-z0-9.]+$/.test(source.id)) err.push(`source id "${source.id}" does not match ^s\\.[a-z0-9.]+$`);
    if (sourceIds.has(source.id)) err.push(`duplicate source id ${source.id}`);
    sourceIds.add(source.id);
  }

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

  for (const a of p.atoms ?? []) {
    const worker = a.worker;
    if (!worker) continue;
    const dependencies = new Set(a.depends_on ?? []);
    const aliases = new Set<string>();
    for (const read of worker.reads ?? []) {
      if (!ids.has(read.atom)) err.push(`${a.id}: worker reads unknown atom ${read.atom}`);
      if (!dependencies.has(read.atom)) err.push(`${a.id}: worker read ${read.atom} is not a declared dependency`);
      if (!/^[a-z][a-z0-9_]*$/.test(read.as)) err.push(`${a.id}: worker read alias "${read.as}" is invalid`);
      if (aliases.has(read.as)) err.push(`${a.id}: duplicate worker read alias ${read.as}`);
      aliases.add(read.as);
    }
    for (const source of worker.sources ?? []) {
      if (!sourceIds.has(source)) err.push(`${a.id}: worker source ${source} is not declared`);
    }
    if (
      worker.max_context_items !== undefined &&
      (!Number.isInteger(worker.max_context_items) || worker.max_context_items < 1 || worker.max_context_items > MAX_CONTEXT_ITEMS)
    ) err.push(`${a.id}: max_context_items must be an integer between 1 and ${MAX_CONTEXT_ITEMS}`);
    if (
      worker.max_context_chars !== undefined &&
      (!Number.isInteger(worker.max_context_chars) || worker.max_context_chars < 256 || worker.max_context_chars > MAX_CONTEXT_CHARS)
    ) err.push(`${a.id}: max_context_chars must be an integer between 256 and ${MAX_CONTEXT_CHARS}`);
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

  // Rules may only name known atoms and real status values.
  const validStatuses = new Set<string>(LADDER);
  const walk = (c: any, ruleId: string): string[] => {
    if (!c) return [];
    if (c.all) return c.all.flatMap((x: any) => walk(x, ruleId));
    if (c.any) return c.any.flatMap((x: any) => walk(x, ruleId));
    if (c.not) return walk(c.not, ruleId);
    if (!c.atom) return [];
    for (const [op, value] of Object.entries(c.status ?? {})) {
      if (!validStatuses.has(String(value))) err.push(`rule ${ruleId}: invalid status ${op} ${value}`);
    }
    return [c.atom];
  };
  for (const r of p.rules ?? []) {
    for (const a of walk(r.when, r.id)) if (!ids.has(a)) err.push(`rule ${r.id}: unknown atom ${a}`);
  }
  return err;
}

export const optionsFor = (a: PackAtom): string[] =>
  a.type === "yesno" ? ["yes", "no", "unknown"]
  : a.type === "score" ? ["1", "2", "3", "4", "5", "unknown"]
  : [...(a.options ?? []), "unknown"];

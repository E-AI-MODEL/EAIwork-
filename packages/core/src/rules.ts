import type { Derived, State } from "./types.ts";
import { rank } from "./derive.ts";

type Cond =
  | { all: Cond[] } | { any: Cond[] } | { not: Cond }
  | { atom: string; status?: { lte?: string; gte?: string; eq?: string }; value?: string };

export interface Rule {
  id: string;
  when: Cond;
  then: { flag: "info" | "warning" | "critical"; message: string; suggest?: string[] };
}

/** Pure data in, flags out. No eval, no model call, no clock. */
function test(c: Cond, state: State, d: Record<string, Derived>): boolean {
  if ("all" in c) return c.all.every((x) => test(x, state, d));
  if ("any" in c) return c.any.some((x) => test(x, state, d));
  if ("not" in c) return !test(c.not, state, d);
  const st = d[c.atom]?.status ?? "unknown";
  if (c.status?.lte && rank(st) > rank(c.status.lte as any)) return false;
  if (c.status?.gte && rank(st) < rank(c.status.gte as any)) return false;
  if (c.status?.eq && st !== c.status.eq) return false;
  if (c.value !== undefined && state[c.atom]?.value !== c.value) return false;
  return true;
}

export function runRules(rules: Rule[], state: State, derived: Record<string, Derived>) {
  return rules.filter((r) => test(r.when, state, derived)).map((r) => ({ rule: r.id, ...r.then }));
}

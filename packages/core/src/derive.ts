import type { Derived, State, AtomState, Status } from "./types.ts";

const L = ["unknown", "assumption", "claim", "observed", "checked", "proven"];
export const rank = (s: Status) => L.indexOf(s);

const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

export interface DeriveOpts { validForDays?: number }

/** Status is computed from current evidence. It is never stored or edited. */
export function derive(a: AtomState | undefined, now: string, opts: DeriveOpts = {}): Derived {
  const reasons: string[] = [];
  const expired: string[] = [];
  if (!a || a.value === undefined || a.value === "unknown") {
    return { status: "unknown", reasons: ["no answer"], expired };
  }
  // Defense in depth: model evidence is kept for audit but never counts as support.
  const live = a.evidence.filter((e) => {
    const stale = opts.validForDays !== undefined && e.attached_at !== undefined && days(e.attached_at, now) > opts.validForDays;
    if ((e.valid_until && e.valid_until < now) || stale) { expired.push(e.id); return false; }
    return e.observer.kind !== "model";
  });
  const pro = live.filter((e) => e.supports);
  const contra = live.filter((e) => !e.supports);
  if (pro.length === 0) {
    return { status: "assumption", reasons: ["no non-model evidence", ...(expired.length ? [`expired evidence ignored: ${expired.join(", ")}`] : [])], expired };
  }
  const lineages = new Set(pro.map((e) => e.lineage));
  const hasObserved = pro.some((e) => e.mode === "observed");
  const hasCheck = pro.some((e) => e.observer.kind === "check" && e.deterministic === true);

  let status: Status = hasObserved ? "observed" : "claim";
  if (hasObserved && lineages.size >= 2) status = "checked";
  if (hasCheck && lineages.size >= 2) status = "proven";
  reasons.push(`${pro.length} supporting item(s), ${lineages.size} independent origin(s)`);

  if (contra.length > 0) {
    reasons.push("contradicting evidence present: capped at claim");
    if (rank(status) > rank("claim")) status = "claim";
  }
  if (expired.length) reasons.push(`expired evidence ignored: ${expired.join(", ")}`);
  return { status, reasons, expired };
}

export function deriveAll(state: State, now: string, validForDays: Record<string, number> = {}) {
  return Object.fromEntries(
    Object.entries(state).map(([k, v]) => [k, derive(v, now, { validForDays: validForDays[k] })]),
  );
}

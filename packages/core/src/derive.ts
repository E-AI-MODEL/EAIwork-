import type { Derived, Evidence, State, AtomState, Status } from "./types.ts";

const L = ["unknown", "assumption", "claim", "observed", "checked", "proven"];
export const rank = (s: Status) => L.indexOf(s);

const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

export interface DeriveOpts {
  validForDays?: number;
  /** Current state, used to test whether a check's recorded inputs still hold. */
  state?: State;
  /** The atom being derived, so a check's own target is not treated as a premise. */
  atom?: string;
  /** Current status of another atom, used for checks that derive from premises. */
  statusOf?: (atom: string) => Status;
}

/**
 * Two supporting items corroborate each other only when they share no link:
 * a different origin, a different observer, and both origins registered.
 * Anything less could be one fact counted twice.
 */
export const independent = (a: Evidence, b: Evidence) =>
  a.lineage !== b.lineage && a.observer.id !== b.observer.id && !a.origin_unverified && !b.origin_unverified;

const isCheck = (e: Evidence) => e.observer.kind === "check" && e.deterministic === true;

const NEXT: Record<Status, string> = {
  unknown: "propose an answer",
  assumption: "attach evidence from a person, a system or a deterministic check",
  claim: "a first-hand observation, or a deterministic check",
  observed: "a second supporting item with a different registered source and a different observer, or a grounded deterministic check",
  checked: "a deterministic check that is grounded in a registered source or in first-hand premises",
  proven: "",
};

/**
 * Status is computed from current evidence. It is never stored or edited.
 * Every status names the rule and the evidence that carry it; nothing is granted by count alone.
 */
export function derive(a: AtomState | undefined, now: string, opts: DeriveOpts = {}): Derived {
  const reasons: string[] = [];
  const expired: string[] = [];
  const stale: string[] = [];
  const out = (status: Status, rule: string, basis: string[], next = NEXT[status]): Derived =>
    ({ status, rule, basis, reasons, expired, stale, next });

  if (!a || a.value === undefined || a.value === "unknown") {
    reasons.push("no answer");
    return out("unknown", "no-answer", []);
  }

  // Defense in depth: model evidence is kept for audit but never counts as support.
  const live = a.evidence.filter((e) => {
    const old = opts.validForDays !== undefined && e.attached_at !== undefined && days(e.attached_at, now) > opts.validForDays;
    if ((e.valid_until && e.valid_until < now) || old) { expired.push(e.id); return false; }
    if (e.observer.kind === "model") return false;
    // A check supports only while the values it read are still the current values.
    if (isCheck(e) && e.basis && opts.state) {
      const moved = Object.entries(e.basis.reads).some(([atom, value]) => (opts.state![atom]?.value ?? null) !== value);
      if (moved) { stale.push(e.id); return false; }
    }
    return true;
  });
  if (expired.length) reasons.push(`expired evidence ignored: ${expired.join(", ")}`);
  if (stale.length) reasons.push(`check no longer matches its inputs and is ignored until it is re-run: ${stale.join(", ")}`);

  const contra = live.filter((e) => !e.supports);
  const proAll = live.filter((e) => e.supports);

  // A deterministic check is trusted, but its footing must be shown. It is grounded when it
  // consulted a registered source, or when every other atom it read is first-hand or stronger.
  // A check that only re-reads the answer it is attached to restates that answer; it adds nothing.
  const grounding = new Map<Evidence, string>();
  for (const c of proAll.filter(isCheck)) {
    const premises = Object.keys(c.basis?.reads ?? {}).filter((id) => id !== opts.atom);
    if (c.basis?.sources?.length) grounding.set(c, `${c.basis.sources.length} registered source(s)`);
    else if (premises.length && opts.statusOf && premises.every((id) => rank(opts.statusOf!(id)) >= rank("observed"))) {
      grounding.set(c, `${premises.length} premise(s) that are all first-hand or stronger`);
    }
  }
  const pro = proAll.filter((e) => !isCheck(e) || grounding.has(e));
  const loose = proAll.filter((e) => isCheck(e) && !grounding.has(e));
  // An ungrounded check still proves when independent support stands next to it.
  const backed = loose.map((c) => [c, pro.find((e) => independent(c, e))] as const).find(([, e]) => e);

  if (pro.length === 0) {
    reasons.push(loose.length
      ? `deterministic check ${loose.map((e) => e.id).join(", ")} has no registered source, no first-hand premises and no independent support: it restates the answer and is not counted`
      : "no non-model evidence");
    return out("assumption", "no-support", []);
  }

  const firstHand = pro.filter((e) => e.mode === "observed");
  let status: Status = "claim";
  let rule = "reported";
  let basis = [pro[0].id];
  reasons.push(`${pro.length} supporting item(s)`);
  if (firstHand.length) { status = "observed"; rule = "first-hand"; basis = [firstHand[0].id]; }

  // checked: a first-hand item corroborated by an independent second item.
  let pair: [Evidence, Evidence] | undefined;
  for (const x of firstHand) {
    const y = pro.find((e) => e !== x && independent(x, e));
    if (y) { pair = [x, y]; break; }
  }
  if (pair) {
    status = "checked"; rule = "corroborated"; basis = [pair[0].id, pair[1].id];
    reasons.push(`${pair[0].id} is corroborated by ${pair[1].id}: different registered origin and different observer`);
  } else if (pro.length > 1) {
    reasons.push("supporting items are not independent: they share an origin or an observer, or cite no registered source");
  }

  // proven: a grounded deterministic check, or a check with independent support beside it.
  const grounded = pro.find((e) => grounding.has(e));
  if (grounded) {
    status = "proven";
    rule = grounded.basis?.sources?.length ? "check-on-registered-source" : "check-on-first-hand-premises";
    basis = [grounded.id];
    reasons.push(`${grounded.id} is a deterministic check on ${grounding.get(grounded)}`);
  } else if (backed) {
    status = "proven"; rule = "check-corroborated"; basis = [backed[0].id, backed[1]!.id];
    reasons.push(`${backed[0].id} is a deterministic check corroborated by ${backed[1]!.id}`);
  } else if (loose.length) {
    reasons.push(`deterministic check ${loose.map((e) => e.id).join(", ")} is not grounded and has no independent support: not counted`);
  }

  if (contra.length > 0) {
    reasons.push(`contradicting evidence present (${contra.map((e) => e.id).join(", ")}): capped at claim`);
    if (rank(status) > rank("claim")) {
      return out("claim", "capped-by-contradiction", basis, "resolve the contradiction: replace the answer or let the contradicting evidence expire");
    }
  }
  return out(status, rule, basis);
}

/**
 * Derives every atom. A check that builds on other atoms needs their status, so this runs to a
 * fixed point from the bottom: no premise counts until it is established without the check that
 * depends on it. Premise cycles therefore never ground themselves, and the result does not
 * depend on the order of atoms.
 */
export function deriveAll(state: State, now: string, validForDays: Record<string, number> = {}) {
  const ids = Object.keys(state);
  let known: Record<string, Status> = {};
  let result: Record<string, Derived> = {};
  for (let round = 0; round <= ids.length; round++) {
    const statusOf = (id: string): Status => known[id] ?? "unknown";
    result = Object.fromEntries(ids.map((id) =>
      [id, derive(state[id], now, { validForDays: validForDays[id], state, atom: id, statusOf })]));
    const next = Object.fromEntries(ids.map((id) => [id, result[id].status]));
    if (ids.every((id) => next[id] === known[id])) break;
    known = next;
  }
  return result;
}

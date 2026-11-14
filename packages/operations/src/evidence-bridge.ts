/**
 * Bridges execution to the evidence ladder without giving execution any authority.
 * The operations journal records what was done. A deterministic rule over that journal can
 * be registered as a server check; the ladder then treats it like any other grounded check.
 * Nothing here writes evidence: the server runs the rule and records its verdict.
 */
import type { OpsEnvelope } from "./registry.ts";

export interface AppliedChange { path: string; proposalId: string; replacementSha256: string; tested: boolean }

export interface JournalCodeState {
  /** Per file, the model-proposed change whose bytes are currently in place. */
  changes: AppliedChange[];
  /** Files with an apply or restore that started but has no recorded outcome yet. */
  pending: string[];
}

/**
 * Replays code actions per file as a stack: an apply pushes, a restore removes that proposal, so
 * restoring the newest change brings the previous applied change back into view. An apply or
 * restore without a recorded outcome leaves the file in an unknown state and is reported as pending.
 */
export function journalCodeState(history: readonly OpsEnvelope[]): JournalCodeState {
  const stacks = new Map<string, { proposalId: string; replacementSha256: string }[]>();
  const open = new Map<string, string>();
  // The latest isolated run for exactly these bytes decides: a later failure revokes an earlier pass.
  const latestTest = new Map<string, string>();
  for (const row of history) {
    const e = row.event as any;
    if (e?.type !== "code.activity") continue;
    const stack = stacks.get(e.path) ?? [];
    if (e.action === "tested" || e.action === "suite-tested") {
      latestTest.set(e.proposalId + ":" + e.replacementSha256, e.result);
    } else if (e.action === "apply-started" || e.action === "restore-started") {
      open.set(e.path, e.proposalId);
    } else if (e.action === "applied") {
      stacks.set(e.path, [...stack.filter((x) => x.proposalId !== e.proposalId), { proposalId: e.proposalId, replacementSha256: e.replacementSha256 }]);
      open.delete(e.path);
    } else if (e.action === "restored") {
      stacks.set(e.path, stack.filter((x) => x.proposalId !== e.proposalId));
      open.delete(e.path);
    } else if (e.action === "aborted") {
      open.delete(e.path);
    }
  }
  const changes = [...stacks.entries()]
    .filter(([, stack]) => stack.length > 0)
    .map(([path, stack]) => {
      const top = stack[stack.length - 1];
      return { path, proposalId: top.proposalId, replacementSha256: top.replacementSha256,
        tested: latestTest.get(top.proposalId + ":" + top.replacementSha256) === "passed" };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  return { changes, pending: [...open.keys()].sort() };
}

/** Every file whose current bytes come from a model-proposed change. */
export function appliedChanges(history: readonly OpsEnvelope[]): AppliedChange[] {
  return journalCodeState(history).changes;
}

/**
 * True when at least one applied change exists, every applied change has a passing isolated test
 * for exactly the bytes in place, and no apply or restore is still unresolved.
 * This is a statement about the journal, not about the quality of the tests.
 */
export function appliedChangesAreTested(history: readonly OpsEnvelope[]): boolean {
  const { changes, pending } = journalCodeState(history);
  return pending.length === 0 && changes.length > 0 && changes.every((change) => change.tested);
}

export const OPERATIONS_JOURNAL_SOURCE = "s.ops.journal";
export const CODE_TESTED_ATOM = "a.code.tested";
export const CODE_TESTED_CHECK = "applied-changes-tested";

/** Pack additions for a server that runs the local code worker. */
export const codeEvidencePack = {
  source: { id: OPERATIONS_JOURNAL_SOURCE, title: "Operations journal (hash-chained record of code actions and isolated test runs)" },
  cluster: { id: "c.code", title: "Code work", atoms: [CODE_TESTED_ATOM] },
  atom: {
    id: CODE_TESTED_ATOM,
    question: "Does every applied code change have a passing isolated test for exactly the applied bytes?",
    type: "yesno" as const,
    impact: "high" as const,
  },
};

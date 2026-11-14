/**
 * Bridges execution to the evidence ladder without giving execution any authority.
 * The operations journal records what was done. A deterministic rule over that journal can
 * be registered as a server check; the ladder then treats it like any other grounded check.
 * Nothing here writes evidence: the server runs the rule and records its verdict.
 */
import type { OpsEnvelope } from "./registry.ts";

export interface AppliedChange { path: string; proposalId: string; replacementSha256: string; tested: boolean }

/** Every file whose latest finished code action left a model-proposed change in place. */
export function appliedChanges(history: readonly OpsEnvelope[]): AppliedChange[] {
  const latest = new Map<string, { proposalId: string; replacementSha256: string; action: string }>();
  // The latest isolated run for exactly these bytes decides: a later failure revokes an earlier pass.
  const latestTest = new Map<string, string>();
  for (const row of history) {
    const e = row.event as any;
    if (e?.type !== "code.activity") continue;
    if (e.action === "tested" || e.action === "suite-tested") {
      latestTest.set(e.proposalId + ":" + e.replacementSha256, e.result);
    }
    if (e.action === "applied" || e.action === "restored") {
      latest.set(e.path, { proposalId: e.proposalId, replacementSha256: e.replacementSha256, action: e.action });
    }
  }
  return [...latest.entries()]
    .filter(([, x]) => x.action === "applied")
    .map(([path, x]) => ({
      path, proposalId: x.proposalId, replacementSha256: x.replacementSha256,
      tested: latestTest.get(x.proposalId + ":" + x.replacementSha256) === "passed",
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * True when at least one applied change exists and every applied change has a passing
 * isolated test recorded for exactly the bytes that were applied.
 * This is a statement about the journal, not about the quality of the tests.
 */
export function appliedChangesAreTested(history: readonly OpsEnvelope[]): boolean {
  const changes = appliedChanges(history);
  return changes.length > 0 && changes.every((change) => change.tested);
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

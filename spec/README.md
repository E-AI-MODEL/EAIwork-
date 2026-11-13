# EAI work specification (v0.1 draft)

1. **Atoms.** One question, one typed answer (yes/no, fixed choice, short score), answerable by one observer. "unknown" is always allowed.
2. **Status ladder.** unknown < assumption < claim < observed < checked < proven. Status is derived from current evidence, never edited.
3. **Evidence.** Each item has observer, mode (reported/observed), lineage, supports flag, optional validity.
4. **Asymmetry rule.** A model may propose, flag and lower confidence. It may not raise status. Raises come from person-attached evidence, independent origins, or deterministic non-LLM checks. Lowered confidence and unevidenced model proposals that the routing policy sends to a person are review signals; they never change status.
5. **Independence and grounding.** No status is granted by count; each names the rule and the evidence that carry it (proposal 0001).
   - Two supporting items are *independent* only if their lineages differ, their observers differ, and neither has an unverified origin. The HTTP server sets lineage to the registered source an actor cites; without one it falls back to the actor identity and marks the origin unverified.
   - A deterministic check is *grounded* if it consulted a registered source, or if every other atom it read is `observed` or stronger. Grounding is computed bottom-up to a fixed point, so a premise cycle never grounds itself.
   - A check carries the values it read. It stops supporting when one of them changes, until it is re-run.
   - `claim`: supporting non-model evidence, reported only.
   - `observed`: at least one first-hand supporting item. A grounded check is first-hand.
   - `checked`: a first-hand item plus an independent second item.
   - `proven`: a grounded check, or an ungrounded check with an independent supporting item beside it. An ungrounded check alone is not counted.
   - Contradicting evidence caps status at `claim`. Expired evidence, stale checks and model evidence never count.
   - Every derived status reports `rule`, `basis` (evidence ids), `reasons`, `expired`, `stale` and `next` (what the next status needs).
6. **Events.** All state is a replay of an append-only, hash-chained log. Identity and time are set by the server.
7. **Rules.** Data-driven conditions (all/any/not on atom status and value). No eval, no model calls.
8. **Reporting.** Distribution per cluster, never a single score. "Nothing flagged" means not detected.
9. **Packs.** Clusters, atoms, dependencies, validity, rules. Linted before use.
10. **Answer scope.** Evidence and lowered-confidence reasons belong to one answer value. Replacing the value clears both. A model may not replace an answer that has non-model evidence. The proposer of the current answer is recorded as provenance and is never an input to status. A worker proposal also records what the model was given: input values, registered sources and a hash of the capsule.
11. **Authorization.** Every principal has explicit read, write, check, worker and audit scopes; access is default-deny and every derived view is filtered to readable atoms. Model actors hold no tokens.
12. **Worker isolation.** A model worker receives one server-built atom capsule: the local question, an optional local claim contract, fixed options, declared dependency values and bounded source snippets. Its output is a probability distribution over the fixed options and can only become an `answer.proposed` event.
13. **Log integrity.** Event and rejection logs are hash-chained and their heads are signed into a witness journal outside the datastore.

## What is normative

- Points 1-10 are defined by `conformance/vectors/`, with `tests/core.test.ts` and `tests/review-signals.test.ts` for what a status-only vector cannot express. If this text and the vectors disagree, fix one of them in a PR.
- Points 11-13 are defined by the trust boundaries in `SECURITY.md` and enforced by `tests/server.test.ts` and `tests/gateway.test.ts`. They are not yet expressed as vectors.
- Everything under `packages/evaluation`, `packages/evidence` and `benchmarks/` is experimental and grants no evidence authority.

# EAI work specification (v0.1 draft)

1. **Atoms.** One question, one typed answer (yes/no, fixed choice, short score), answerable by one observer. "unknown" is always allowed.
2. **Status ladder.** unknown < assumption < claim < observed < checked < proven. Status is derived from current evidence, never edited.
3. **Evidence.** Each item has observer, mode (reported/observed), lineage, supports flag, optional validity.
4. **Asymmetry rule.** A model may propose, flag and lower confidence. It may not raise status. Raises come from person-attached evidence, independent origins, or deterministic non-LLM checks. Lowered confidence and unevidenced model proposals that the routing policy sends to a person are review signals; they never change status.
5. **Independence.** Two items are independent only if their lineages differ. The HTTP server derives lineage from the authenticated actor, so independence currently means "a different trusted actor", not "a different underlying source" (open: proposal 0001).
   - `claim`: supporting non-model evidence, reported only.
   - `observed`: at least one first-hand supporting item.
   - `checked`: first-hand support and at least two lineages.
   - `proven`: a deterministic check and at least two lineages. A check alone is `observed`.
   - Contradicting evidence caps status at `claim`. Expired evidence and model evidence never count.
6. **Events.** All state is a replay of an append-only, hash-chained log. Identity and time are set by the server.
7. **Rules.** Data-driven conditions (all/any/not on atom status and value). No eval, no model calls.
8. **Reporting.** Distribution per cluster, never a single score. "Nothing flagged" means not detected.
9. **Packs.** Clusters, atoms, dependencies, validity, rules. Linted before use.
10. **Answer scope.** Evidence and lowered-confidence reasons belong to one answer value. Replacing the value clears both. A model may not replace an answer that has non-model evidence. The proposer of the current answer is recorded as provenance and is never an input to status.
11. **Authorization.** Every principal has explicit read, write, check, worker and audit scopes; access is default-deny and every derived view is filtered to readable atoms. Model actors hold no tokens.
12. **Worker isolation.** A model worker receives one server-built atom capsule: the local question, an optional local claim contract, fixed options, declared dependency values and bounded source snippets. Its output is a probability distribution over the fixed options and can only become an `answer.proposed` event.
13. **Log integrity.** Event and rejection logs are hash-chained and their heads are signed into a witness journal outside the datastore.

## What is normative

- Points 1-10 are defined by `conformance/vectors/`, with `tests/core.test.ts` and `tests/review-signals.test.ts` for what a status-only vector cannot express. If this text and the vectors disagree, fix one of them in a PR.
- Points 11-13 are defined by the trust boundaries in `SECURITY.md` and enforced by `tests/server.test.ts` and `tests/gateway.test.ts`. They are not yet expressed as vectors.
- Everything under `packages/evaluation`, `packages/evidence` and `benchmarks/` is experimental and grants no evidence authority.

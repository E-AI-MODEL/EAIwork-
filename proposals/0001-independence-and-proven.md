# Proposal 0001: what counts as an independent origin, and what `proven` requires
- Status: accepted in direction by the owner on 2026-11-13, implemented on this branch; merging confirms it
- Affects: spec / core / server / client

## Problem

Two steps of the status ladder were granted by counting, not by a footing that can be pointed at.

1. **Independence was per actor.** The server set lineage to the actor, so two people who looked at the same form produced `checked`.
2. **`proven` was a check plus any second lineage.** A reported claim plus a check was `proven`; the check itself could be a rule that only re-read the answer.

The owner's direction: both steps are doubtful as they stand. The system may be trusted more, but only where its action has a stated basis and is not arbitrary.

## Decision

One principle for both: **a status needs a footing that can be shown, and it lasts only as long as that footing does.**

- **Independent** means no shared link: a different registered source and a different observer. Evidence without a registered source supports but cannot corroborate.
- **Proven** is a deterministic check that is grounded: it consulted a registered source, or every other atom it read is first-hand or stronger, or independent evidence stands beside it. A grounded check proves without a person. A check that only restates its target is not counted.
- **A proof expires with its inputs.** The server records what a check read; when a value changes the check stops supporting until it is re-run.
- **Every status explains itself**: rule, carrying evidence, and what the next status needs.
- **A model proposal records what the model was given**, and is flagged when its inputs change.

Options from the draft that this replaces: independence B and C are combined (source and observer must both differ); proven is F (a check can prove alone) made conditional on grounding, with the old corroboration path kept.

## Evidence (link bibliography ids, or say "untested")

Untested with users. `kim-2025` (models share errors) and `bansal-2021` (people over-rely on AI suggestions) argue against granting strength by repetition. No measurement yet shows how often real packs can register sources for person evidence.

## Conformance vectors this adds or changes

- 018 rewritten: an ungrounded check adds nothing.
- 021 same source, two observers: observed. 022 one observer, two sources: observed. 023 unregistered origin cannot corroborate.
- 024 check on a registered source proves alone. 025 check on premises needs first-hand premises. 026 premise cycle proves nothing.
- 027 check goes stale when an input changes. 028 contradiction caps a grounded check.
- 006, 007, 008 pass unchanged.

## Risks

- **Existing logs can drop on replay.** A check with no recorded basis and no independent support no longer counts. Evidence recorded before this change keeps its actor lineage and is not marked unverified, so two-actor `checked` results in old logs stand; new evidence needs a registered source.
- **Declared sources are trusted.** The server cannot verify that a check's code really consults the source it declares. This moves trust to check registration, which is deployment-time and reviewable.
- **Packs must register sources** for person evidence to corroborate. A pack without sources can reach `observed` and, through grounded checks, `proven`, but not `checked`.
- **Check rules carry weight.** A check on first-hand premises is only as right as its rule. The inspector shows the rule's description and the values it read; it does not judge the rule.

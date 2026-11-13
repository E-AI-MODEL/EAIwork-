# Proposal 0001: what counts as an independent origin, and what `proven` requires
- Status: draft
- Affects: spec / core / server

## Problem

Two rules of the status ladder are implemented more narrowly than the words around them suggest. Both were found in the alignment review of 2026-11-10 (`docs/alignment/`). The code is consistent and tested; the open question is whether it is the rule the project wants.

1. **Independence is per actor, not per source.** The server sets evidence lineage to `actor:<kind>:<id>`. Two people who each attach the same signed form as first-hand evidence therefore produce `checked`. The spec calls lineage an "origin chain", which reads as the underlying source.
2. **`proven` does not sit on top of `checked`.** `derive.ts` grants `proven` for a deterministic check plus at least two lineages. A single *reported* claim plus a check is `proven`, although the same atom without the check would only be `claim`. A check on its own is `observed` (vector 018).

## Options

**Independence**

- A. Keep actor-based lineage and say so everywhere (done in README and spec with this proposal). Cheapest; "checked" then means "two trusted actors vouch first-hand".
- B. Derive lineage from the source: evidence names a broker-owned source handle and lineage becomes the handle (plus its version). Two people citing one document are one origin. Needs a source registry for person evidence, which does not exist yet.
- C. Both: an item is independent only if actor *and* source differ. Strictest, and it makes `checked` unreachable for atoms with a single authoritative document unless a check exists.

**Proven**

- D. Keep the current rule and document it (done).
- E. Require `checked` first: a deterministic check only lifts an atom that already has first-hand support from an origin other than the check.
- F. Let a deterministic check prove on its own. Simplest to explain, but it removes the independent human observation from the strongest status.

## Evidence (link bibliography ids, or say "untested")

Untested. No user study or incident informs the choice. `kim-2025` (shared errors across models) and `bansal-2021` (over-reliance) argue for keeping a human, source-independent observation in the two strongest statuses, which favours B or C and E.

## Conformance vectors this adds or changes

- Vector 018 already pins "check alone is observed".
- A or D: add a vector for "two actors, same source: checked" and one for "reported claim plus check: proven", so the current behaviour is deliberate.
- B or C: vector 007 keeps passing; add "two actors, same source handle: observed".
- E: add "reported claim plus check: claim"; vector 008 keeps passing.
- F: vector 018 changes to `proven`.

## Risks

- B, C and E lower the status of existing logs on replay. That is the intended effect of derived status, but release notes must say so.
- B and C need person evidence to reference a registered source; free-text `source` strings cannot carry independence.
- Leaving both undecided is also a risk: the UI says "checked" and "proven" and readers assume the stricter meaning.

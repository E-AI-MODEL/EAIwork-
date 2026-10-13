# UMDT-inspired evidence observation in EAIwork

**Status:** experimental, read-only evidence-reference gate. This is NOT a semantic verifier or a new source of authority.

## What was reused from UMDT

Source repository: [E-AI-MODEL/umdt](https://github.com/E-AI-MODEL/umdt), inspected at its `main` revision on 2026-10-14.

- `packages/umdt-core/src/engine.ts`: `evalRubrics → classifyFromHits` separates source observations from classification. It captures specific source spans. **We reuse the separation and span discipline, not the regex misconception classifier or its confidence values.**
- `packages/umdt-core/src/gate.ts`: `decideGate` is a deterministic function whose policy can force observation or human review. **We reuse fail-closed routing, not UMDT's `APPLY_TEMPLATE` intervention or education-level rules.**
- `packages/umdt-core/src/explanation.ts`: return a structured rationale the UI can render; explicit flags and reasons instead of a paragraph from a language model.
- `packages/umdt-contracts/src/analyze.ts`: typed data contracts with validation at boundaries.
- `docs/adr/001-heuristic-classifier.md`: the engine detects only what its taxonomy describes; pattern matches do not prove a claim.

UMDT is primarily a deterministic **misconception detection tool** for learner answers. It does **not** contain an off-the-shelf entailment prover for arbitrary documents. Importing its misconception regexes or its 0.55/0.75/0.85 confidence heuristic into EAIwork would be a category error.

## The new boundary

```
Atom question & local claim
       │
       ▼
Model proposes yes/no/unknown, optionally exact citation anchors
       │
       ▼
EAIwork observer (no model, pure deterministic)
  1. Is each handle explicitly authorized for THIS atom?
  2. Does that exact source excerpt exist in the controller?
  3. Are offsets integers and within that excerpt?
  4. Does the quoted text equal precisely the located slice?
  5. Is the reference duplicated or malformed?
       │
       ▼
UMDT-like decision gate
  - unknown assertion              → OBSERVE_ONLY
  - yes/no without a valid source   → ASK_FOR_SOURCE
  - invalid/unauthorized citations  → ROUTE_TO_HUMAN
  - valid reference, low impact     → SEMANTIC_REVIEW_REQUIRED
  - independent contradiction / high impact → ROUTE_TO_HUMAN
  - explicit observe policy         → OBSERVE_ONLY
       │
       ▼
Separate semantic review by a trusted checker/person
       │
       ▼
Existing EAIwork evidence/event authority ladder (unchanged)
```

The pure observer is in `packages/evidence/src/observe.ts` and has **no event writer, no LLM call and no imported status-promotion API**. Every output explicitly includes `semanticSupport: "NOT_EVALUATED"` and `authorityRaised: false`. An anchored quote can be irrelevant, misleading, forged in the underlying source, stale or self-contradictory. The observer cannot tell.

### Exact scope

`observeLocalEvidence` receives only a local claim, a tentative answer, a broker-authorized excerpt list, explicit local allowlist, proposed references, and trusted review policy. The policy and source list **must be supplied by the authenticated controller**, not taken from a model response. The model must never receive parent project context, neighboring atom contents, a hidden benchmark gold label or source policy internals.

A proposed reference identifies a local source handle and UTF-16 `start` / `end` offsets plus an exact `quote`. The checked reference contains offsets and SHA-256 hashes only; no raw text or quote is placed in the return value. Hashes bind to *submitted bytes*, not to a trusted publication identity. Repeated references to one passage do not count as independent corroboration.

### Examples

```ts
import { observeLocalEvidence } from "./packages/evidence/src/observe.ts";
const source = "The record explicitly rejects request R-28.";
const quote = "rejects request R-28";
const start = source.indexOf(quote);
const observation = observeLocalEvidence({
  claim: "Request R-28 was approved.",
  answer: "no",  // provisional model verdict
  authorizedHandles: ["approval.record"],
  sources: [{ handle: "approval.record", content: source }],
  proposedReferences: [{ handle: "approval.record", start, end: start + quote.length, quote }],
  policy: { impact: "high" },
});
// observation.route === "ROUTE_TO_HUMAN"
// observation.semanticSupport === "NOT_EVALUATED"
```

The exact citation here is valid; a trained reviewer or separately validated semantic engine still has to judge whether the source *refutes* approval. High model probability can never substitute for that step.

## Non-goals and remaining work

- **Not** the UMDT regex engine repurposed to infer objective truth.
- **Not** automatic accept/reject of a proposition; only citation integrity and review routing.
- **Not** an evidence promotion shortcut, self-check by the same model, or verifier of source authenticity.
- **Not yet wired** to the current Ollama worker response: that provider currently returns **only a probability distribution**, not source anchors. Calling the observer on a hypothetical citation would be fake verification.
- **Not** a replacement for EAIwork's non-model evidence constraints, actor authorization, or independent-origin requirements.
- **No new UI claim** of `checked` or `proven` on the strength of an exact text match.

Next integration should supply citations through an independently permissioned controller interface or add a well-tested structured **proposal** channel to the worker protocol. Then test both presence and absence of citations, nonexistent source handles, malicious quote instructions, duplicate origins, source-version drift and actual human reviews. Do not turn a missing source into an automatic refutation. Keep high-risk and `exam_like` workflows under explicit human policies.

## Tests

`node --test tests/evidence-observer.test.ts` plus the existing `npm test` suite. The tests explicitly check that irrelevant exact quotes **do not** become semantic evidence, while invalid or foreign references fail closed.

# Model-capability neutral EAIwork: execution first, verification outside the model

**Status: working opt-in model proposal transport; not a deployed semantic verifier.**

## Why

The architecture should not force a stronger model into the limitations of a small heuristic engine. After inspecting EAI Standard, UMDT, Shadowseed and *An EAI Agentic Way*, we retain three **responsibilities**, not five mandatory runtime services:

1. **Execution**: a model or deterministic tool may reason inside its approved task. The existing `AtomCapsule` provides bounded local context; it need not reproduce the parent project's intent. For broader tasks, use a separately authorized execution workflow, not a hidden expansion of an atom's context.
2. **Control**: policies, actor permissions, allowed sources and independent source checks live outside model prompts. These checks **cannot assert that a quoted passage semantically proves a claim**.
3. **Record and present**: proposed answers, review outcomes and official evidence/status remain distinguishable. EAIwork's existing replay/authority logic stays authoritative. No new SSOD/SSOT/SSOM/SSOV framework or parallel event store is created.

UMDT's deterministic classifier is a *specialized option* in control, not a universal meaning engine. SSL/Shadowseed may someday suggest missing evidence, but is not required for normal tasks. Model selection remains independent.

## Implemented: optional local citation proposal

Existing providers implement `ModelSession.answer(capsule)` and return a probability distribution. **No existing provider needs to change.**

Providers *may also* implement `ModelSession.propose(capsule)` returning:

```ts
{
  probabilities: { yes: 0.9, no: 0.05, unknown: 0.05 },
  references: [
    { contextIndex: 0, start: 0, end: 34, quote: "exact substring of context[0] here" }
  ]
}
```

This interface is called only when:
- the trusted caller opts into `executeAtomWorker(..., { observeEvidence: true })`, **and**
- the atom has a local `decision.kind === "verify-claim"` contract and `type === "yesno"`, **and**
- the selected provider implements `propose`.

The default path remains exactly the old, single-use `answer` request. A choice/score task is **not** secretly forced through a yes/no fact-check gate. If a provider cannot propose, the result explicitly reports `provider-unsupported`. Other tasks report `not-applicable`.

### No source-handle leakage

Only the atom-local `context: string[]` reaches the model. A model refers to `contextIndex`, the zero-based local snippet index. The controller maps those indices to temporary `local.0` handles **after** generation. Source brokers, pack IDs, global goals, sibling atoms, actor identities and expected benchmark labels never enter the model prompt. This is a local excerpt binding, **not yet a persistent SSOD source ID**.

For a rich proposal, `observeLocalEvidence` deterministically checks that a passage exists at those exact offsets, belongs to the current local context, and matches its quote. This runs after the model and never triggers a second model call.

### Evidence is not authority

The returned optional sidecar has two explicitly independent concepts:
- `worker.route`: the original **provisional** response routing, unchanged by evidence proposals.
- `worker.evidence.observation.route`: a **separate** route for reviewing citation integrity and semantic fit. An exact quote always has `semanticSupport: NOT_EVALUATED` and `authorityRaised: false`. Invalid references trigger further review; no-quote proposals request a source. This never writes `evidence.attached`, `check.passed`, or any authority event.

A valid quote can be irrelevant or misleading; the validator **does not** determine entailment. Even if a model reports confidence 1.0, that does not increase evidentiary status. If an optional proposal omits citations, this does not retroactively make the model's reasoning false. It only leaves the source claim unverified.

The current Ollama provider implements this optional method with a separate strict JSON schema and a larger response-token budget. It is an opt-in addition to the local-only provider, not a new forced default. Its response parser rejects malformed proposal JSON without echoing source text into exception messages. Larger/remote models need their own vetted adapters and consent rules.

## Example

```ts
import { executeAtomWorker } from "./packages/gateway/src/gateway.ts";
import { ollamaProvider } from "./packages/gateway/src/ollama-provider.ts";

const result = await executeAtomWorker(
  ollamaProvider({ model: "qwen2.5:7b" }),
  atom, state, scopedSourceBroker,
  { observeEvidence: true },
);

// result.value is a provisional model answer.
// result.evidence?.status === "observed" means only citation integrity was observed.
// NEVER treat result.evidence as a server-trusted evidence attachment.
```

No public HTTP request can enable this option: the trusted server controller still executes workers via the unchanged default path. This preserves the existing actor permissions, status rules, signed audit log and backward compatibility while the new capability is tested.

## What remains to prove

This is **transport and trust-boundary work**, not evidence of quality improvement. No fresh real-model quality benchmark has been run just by merging it.

To establish value:
- compare the same strong model with and without optional citation proposals, using an unseen holdout;
- measure reference integrity, true semantic support by independent reviewers, abstentions, false certainty, error rate, latency and token cost separately;
- then decide whether the opt-in method is worth enabling on real workflows;
- design a broker-owned, version-pinned provenance record **before** claiming citation traceability back to SSOD, and test changing sources between retrieval and review.

**Decision:** no mandatory SSOD/SSOT/SSOM/SSL/SSOV scaffolding is added to the runtime. Those are useful responsibility labels and constraints, not a justification for more services, prompts or approvals.

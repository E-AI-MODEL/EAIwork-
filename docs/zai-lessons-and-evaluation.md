# Model evaluation: lessons from the Z.ai / GLM prototype

**Status: DEV evaluation harness, not a product certification.**

## Provenance and decisions

Review basis: the user-provided Z.ai/GLM Next.js project snapshot, especially:
- `src/lib/ssl/test-session-service.ts` and `test-telemetry.ts`: a **read-only observation layer**, separated from authority writes.
- `src/lib/router.ts`: deterministic model routing with readable decision reasons; short requests are not necessarily simple.
- `docs/benchmark-m2-acquisition.md` and `docs/benchmark-m2-acquisition-spec.md`: explicit DEV/HOLDOUT separation, error-cost asymmetry, unknown/fail-closed outcomes, repeatability, and honest invalid-run reporting.
- `upload/Shadowseed_Next_convergentieplan.md`: preserve the accessible product experience, but keep observation, evidence, authority, relevance and use separate.

**Transfer to EAIwork:** reuse those *engineering lessons*, not SSL seed, recurrence, chat memory or authority code. An EAIwork model receives only an isolated `AtomCapsule`. Truth labels, neighboring benchmark cases, and metrics stay outside that capsule.

## Run a real model on local Ollama

```sh
ollama pull qwen2.5:7b
EAI_BENCH_MODEL=qwen2.5:7b node benchmarks/run-model.ts benchmarks/evidence-controls.dev.json
```

For another model repeat exactly the same command with `EAI_BENCH_MODEL` changed. The optional third positional argument changes repetitions (1–5). Default is 3.

The initial 8 cases are public **DEV controls**, not an unseen holdout, comprehensive safety test, production benchmark, or reliable estimate of real-world quality. No model has been run against this suite merely by merging the code. A proper holdout must be independently created, frozen and run without tuning on its answers.

## What the report means

- **Valid trials**: accepted model response with allowed options, not necessarily correct.
- **Accuracy on valid**: excludes model/transport failures, which are counted separately. If none succeed, accuracy is `null`, not 0%.
- **Unknown correctness / unsupported false positives**: tests whether the model refrains from asserting an answer when evidence is insufficient or contradictory.
- **High-confidence errors**: wrong answers for which the model reported a probability >= 0.8. This is *self-reported confidence*, not demonstrated calibration.
- **Unsafe assumptions**: an incorrect answer passed the runtime's ordinary low-risk `accept-as-assumption` route. That route never increases evidence authority.
- **Repeatability**: all repetitions for a case had identical outputs. Agreement alone does not demonstrate correctness.
- **Latency**: median response time for valid responses. Not a model quality metric.
- **Case/category telemetry**: labels, decisions, routes, timings and errors; no raw source excerpts, API keys or prompts.

Higher-risk mistakes weigh more heavily during model selection. **Never automatically promote a model based on this tiny fixture or these raw metrics.**

## Design constraints

1. Evaluator is read-only: no event writes, evidence updates, Gate or authority changes.
2. Each trial calls `executeAtomWorker` with only the case's declared source handles. A fresh model session is opened for each trial.
3. No evaluator truth label, sibling question, global project goal or source handle is sent to the model.
4. Invalid JSON and transport errors are reported separately and never silently treated as `unknown` successes.
5. The DEV suite is synthetic. No student, employee or customer information is used.
6. A remote/hosted GLM adapter is **not** added here. Introducing one requires a separate provider security and consent review.
7. This does not compare independent atom work against a whole-task baseline yet. That needs a separate protocol with a fair output contract.

## Identified limits in Z.ai snapshot

The prototype's M2 semantic benchmark had documented incomplete runs caused by HTTP 429 rate limits. Those results are not evidence that the semantic matcher worked well. Its attractive UI and test tooling are product strengths, but its visitor-ID isolation is explicitly not full authentication and its hash-chain append path deserves contention testing. Neither weakness is copied into EAIwork.

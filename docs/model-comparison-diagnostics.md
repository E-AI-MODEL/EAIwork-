# Model comparison: diagnostic and validity rules

**Development instrumentation — not a model leaderboard or a causal experiment.**

## What the first real runs showed

Qwen 2.5 3B, DEV suite v0.2, runner `38469406031`:
- **Isolated**: 7/8 valid, 3/7 correct among valid, 2/6 correct unknown, 4 unsupported assertions, 1 execution error.
- **Whole task**: 8/8 valid, 8/8 correct, 6/6 correct unknown, 0 execution errors.
- The job failed by design because one execution failed. **Do not treat the failed process status as meaning no observations exist.**
- Earlier DEV v0.1 scores were based on semantically ambiguous questions. They must never be used as an improvement baseline for v0.2.

The run exposed two shortcomings in the evaluation harness. First, the CLI displayed only aggregate scores, concealing the identity and category of the failing case. Second, the whole-task evaluator used descriptive case IDs such as `conflicting-records` and `empty-record`, while isolated workers never saw those labels. These IDs disclosed hints about the expected outcome and were an **evaluation leakage risk**. The v0.2 whole-task score is therefore confounded: **do not claim that whole-task reasoning is better on this evidence**.

## How the instrument was repaired

- Whole-task prompts now receive only opaque neutral IDs `q0001`, `q0002` and so on. Original case IDs and expected answers stay evaluator-side for scoring. The output keys are mapped back to original case IDs after model execution.
- Both arms retain local proposition, authorized snippets and response-contract definitions. Neither arm receives the expected label or case category.
- Per-case output now includes the real evaluator case ID, expected/predicted label, self-reported winning-option probability, and sanitized error category (timeout, transport, invalid-response, other).
- Raw exceptions are deliberately discarded because provider messages can contain document excerpts, host metadata or tokens. Do not add raw error text to this report.
- A local JSON file is generated even when one arm fails. On GitHub Actions, upload is conditional on the file existing and uses an explicit pinned action SHA. The file contains no source snippets or prompts; benchmark IDs themselves may still be sensitive in non-demo settings.

Example:
```sh
EAI_BENCH_MODEL=qwen2.5:3b node benchmarks/compare-model.ts \
  benchmarks/evidence-controls.dev.json ./comparison.json
```

To access GitHub artifacts, open the corresponding `model-head-to-head` run and download **case-diagnostics**. The file is generated in a runner, not persisted to the repository or product's evidence log.

## What remains unequal

The whole-task arm still sees eight case contexts simultaneously and uses one batch request with larger generation budget; the atom arm sees only its own local context, uses eight small requests with bounded concurrency, and has a smaller per-request response budget. This is the architectural contrast being inspected, **not a fair test of isolated versus holistic reasoning under matched computational budgets**. A neutral group label does not solve context pooling, prompt shape, call count, model/cache effects, or latency comparability.

Do not tune prompts on the same eight development examples, then claim generalization. For external-validity work use independently written holdout cases, frozen criteria, repeated runs and stronger models. Neither the model nor evaluator may change status or attach evidence through these runs.

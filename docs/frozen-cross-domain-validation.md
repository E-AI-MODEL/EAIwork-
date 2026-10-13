# Prospective cross-domain validation (frozen v1)

This suite is an **independent fixture design relative to the approval-themed DEV cases**. It was authored and frozen on 2026-10-13 **before** observing any real-model outputs on the new examples. It is **not** a hidden holdout: it is committed in plain text, publicly inspectable, and may eventually leak into future model development. Never call it a certified benchmark or independent external audit.

## Predeclared protocol

- Suite `benchmarks/validation/cross-domain.v1.frozen.json` has **16 cases** across inventory, committee grant decisions, laptop encryption, shipment deadlines, backup deletion and supplier conformity. There are **5 supported, 5 refuted, 6 insufficient/contradictory** outcomes.
- Every case has one atom-local claim and a source snippet. Categories and answer keys remain **outside model requests**.
- The same frozen suite is used in both evaluation arms: anatomical single-atom capsules vs one whole-task batch. Model-visible batch keys are neutral `q0001` identifiers.
- Predeclared primary measures: **correct unknown among expected unknown**, **unsupported false-positive rate**, and **valid-output rate**. Secondary measures: correct among valid, self-reported high-confidence errors, wall time. None of the percentages is a calibrated probability.
- Never alter the suite, expected answers, shared instruction contract, scoring, or choice of models based on these results. If an ambiguity is independently discovered, disclose it and create **v2** without overwriting v1. Do not compare different suite versions as if they were identical.
- Proposed models: **Qwen 2.5 3B and Qwen 2.5 7B**, each running on a fresh Ubuntu GitHub CPU-only runner. Both use the same atomic contract, `temperature: 0`, version-pinned repository code and the same sampling defaults. The two arms still differ in request count, batching and `num_predict` limits, and the underlying CPU timing is not controlled.

## Diagnosing the previous real-model failure

The last DEV comparison (GitHub run `38470704484`) showed one invalid isolated response in case `verified-yes`. Existing logs record only `invalid-response`. That is insufficient to distinguish malformed JSON, missing answer keys, invalid numeric values, unapproved keys, zero-mass distributions or an empty model message.

A new **typed failure code** is emitted from Ollama parsing:
`non-json`, `invalid-object`, `missing-option`, `invalid-probability`, `extra-option`, `zero-probability`, or `empty-content`.

The report attaches such codes per failed trial, with no raw output, source snippet, exception string, prompt, token, or API key. This supports diagnosis without exposing protected content. The code is emitted only when the provider's parse path can determine it; a timeout, connection failure or generic runtime exception may still have no output subtype.

**We cannot retroactively recover the specific parsing defect of `verified-yes` from the previous run.** Only a new run with improved instrumentation can reveal an output subtype if a failure recurs. Even then it is evidence about that new run, not necessarily the cause of the historical failure.

## Execute

```sh
# Node >= 22.18, Ollama running with the model installed
EAI_BENCH_MODEL=qwen2.5:3b node benchmarks/compare-model.ts \
  benchmarks/validation/cross-domain.v1.frozen.json validation-report.json
```

The GitHub workflow `frozen-cross-domain-validation.yml` executes both Qwen 3B and Qwen 7B on separate machines and preserves outputs as `validation-qwen3b` and `validation-qwen7b` artifacts.

An execution with even one failed model output gets a failed CI result intentionally. Read its case diagnostics and report artifact anyway, do **not** omit that model when reporting results.

## Limits

This fixture is synthetic, mostly document-oriented and short; it does not test an authentic multi-step work graph, source-retrieval quality, user outcomes, risk calibration, or production security. It has no real student/patient/customer data. The validation itself does not write into the EAIwork evidence or authority event store. Neither arm may see evaluator truth labels; neither model may promote evidence status.

Only after this instrument is trustworthy should a **separately authored task-level multi-atom study** with explicit dependencies, ablations, and a stronger GLM provider be undertaken.

# Atom workers versus one whole-task model: comparative DEV protocol

**Status: experimental evaluation, not a product certification.**

This is the next test after the Z.ai/GLM review: measure whether EAIwork's strict anatomical separation changes task outcomes, rather than merely verifying transport, session freshness, and JSON parsing.

## Two arms

- **Atom**: each case is executed through production `executeAtomWorker`. Each model request sees its own `AtomCapsule`, its own authorized source excerpts and nothing about siblings or truth labels. Workers are run concurrently. No project-level context is supplied.
- **Whole**: a purpose-built **evaluator-only** adapter sends *all* questions and the same locally allowed excerpts in a single model request. This adapter must never be imported into the worker server. It cannot write evidence or model status.

This comparison changes the **information boundary and number of requests**. Thus it is not a controlled comparison of equal token budgets, latency, model reasoning quality, tool access or money. In particular, one large request and many smaller concurrent requests have different costs and truncation behavior.

## Run

```sh
ollama pull qwen2.5:7b
EAI_BENCH_MODEL=qwen2.5:7b node benchmarks/compare-model.ts benchmarks/evidence-controls.dev.json head-to-head.json
```

Requires Node 22.18+ and a local running Ollama service; a model download may exceed the available memory of a small runner. The optional output path uses exclusive creation and does not overwrite an earlier report. The model identifier is identical in both arms. Test other models (for example a stronger GLM provider) only once a separate trusted and consent-governed adapter has been introduced.

## Scorecard

| Measure | Interpretation |
|---|---|
| Valid answers | Output format accepted; not an endorsement |
| Correct answers | Agreement with the synthetic case's stated ground truth |
| Correct `unknown` | Model declines to assert an outcome where the fixture says there is insufficient evidence |
| Unsupported false positives | Model asserts `yes`/`no` despite an expected `unknown` |
| Confident errors | Wrong answer with model-assigned probability >=0.8; **not** calibrated confidence |
| Failures | Invalid JSON, transport errors and other runtime failures, counted separately |
| Elapsed time | Wall time of the entire arm; not matched for token use or fairness |

**The development fixture is visible to the developer. It is not a holdout.** Models can be tuned against this set. To make a defensible claim, freeze the evaluator protocol and scoring, create an unseen independent holdout, pre-register an error-cost policy, run pre-selected models on the same hardware/time window (or report hardware), repeat independent trials, report uncertainty intervals, and retain all failures. The Z.ai benchmark notes show why invalid/rate-limited runs must not be interpreted as model wins.

## Trust boundaries and known limits

The atom model is blind to the parent task at the **request interface**. It is not guaranteed that source text itself cannot contain global clues. A separate, deliberately privileged benchmark adapter does see the whole problem, but it cannot be used through production worker routes.

The current comparator is for **small bounded cases** (the included cases each contain one short source). For larger cases, context clipping may differ between the arms: use common source budgets and record the actual content passed to each model before making a scientific comparison. The baseline receives synthetic `caseId` labels to align answers, but not expected/truth labels. The scorecard itself has no source excerpts, model prompts, token usage or secrets.

The suite is not a genuine real-world multi-step job. A later task-level test must measure dependency handling, recovery from failing workers, evidence-chain integrity, and what users understand from the UI. No real model scores have been claimed by adding this code.

## Integration limits

This harness is **not** an agent, a production workflow scheduler, a model router, a GLM API connector, a new authorization role or a UI deployment. It is an external evaluator intended to inform these features without allowing a benchmark to modify the EAIwork evidence ladder.

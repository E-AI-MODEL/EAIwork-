# After-action report: first cross-domain 3B/7B validation

## Observations, not architectural verdicts

Frozen public fixture v1, GitHub Actions run [38471684731](https://github.com/E-AI-MODEL/EAIwork-/actions/runs/38471684731), 16 short cases with 5 expected yes, 5 expected no and 6 expected unknown.

| Measure | 3B isolated | 3B whole | 7B isolated | 7B whole |
| --- | ---: | ---: | ---: | ---: |
| Valid outputs | 14/16 | 15/16 | 16/16 | 0/16 |
| Correct among valid | 6/14 | 10/15 | 12/16 | Not measurable |
| Correct unknown | 2/6 | 2/6 | 2/6 | Not measurable |
| Unsupported assertions on expected unknown | 4 | 3 | 4 | Not measurable |
| Invalid isolated distributions | 2 | N/A | 0 | N/A |
| Whole batch request timed out | N/A | No | N/A | **Yes, one request** |

The initial report counted **16 case outputs** as failed for 7B whole. That is an artifact of **one batch request** timing out after 120,000 ms. It is not evidence of 16 independently failed judgments or of 7B having zero accuracy. All 16 cases are unassessed for that arm.

For 3B, two individual model outputs were **zero-probability distributions** (all options zero): `device-encrypted` and `data-deleted`. Rejecting them is correct. No default `unknown` or fabricated probabilities were substituted.

## Instrument correction

- A new `wholeRequestFailure` field records failure of the single whole-model request separately from its downstream unassessed cases; `wholeRequestOutputIssue` reports only a fixed output issue code when one is available.
- A configurable **whole batch timeout** is explicit: `EAI_BENCH_WHOLE_TIMEOUT_MS=300000` on the runner; it has a maximum of 600,000 ms. Individual atom timeout remains 120,000 ms. This is a transport/CPU budget adjustment, **not** a model prompt or benchmark-answer adjustment.
- A whole-model malformed JSON response now produces a fixed non-sensitive output error rather than a raw parser exception.
- The frozen validation cases and expected answers remain byte-for-byte unchanged. A second run is a **retry on a public, previously seen fixture**, not a genuinely new blinded holdout.

## Interpretation boundaries

The 7B isolated arm improved validity and correct assertions on these cases compared with 3B, but still incorrectly asserted a definite answer in four of six missing/contradictory cases. Larger models do not remove false certainty on their own.

The whole task's timeout can be due to length, JSON-schema constrained decoding, CPU speed, token budget or Ollama runtime factors. A longer limit may complete the request, but a result cannot be treated as a fair latency comparison against independent short atom requests. Neither arm gets to claim security or epistemic authority from its self-reported probabilities.

Do not decide to deploy, route or promote a model automatically from this fixture. The next substantial product work should investigate input evidence and the system's authority/verification stage, rather than optimizing one prompt to this test's gold labels.

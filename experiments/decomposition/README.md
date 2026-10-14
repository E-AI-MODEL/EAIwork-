# EAIwork Decomposition Lab — research only

**State:** DEV experiment, no changes to production EAIwork, pack builder, gateway, evidence authority, or worker runtime. This is NOT a certification or a demonstrated neurosymbolic performance improvement.

## Purpose

Measure whether preserving **source-anchored meaning and constraints before atomization** improves instruction interpretation compared with one-pass whole-task interpretation. Inspired by legacy EvAI LSSL and policy checks, EAT/EAT-inline source identity, PIM span precedence, NGBSE hypotheses, SSL weight-zero candidates, and UMDT-style decision gates. These are *inspirations*, not imported production components.

The benchmark currently tests **the extraction of explicitly expressed instruction fragments**, not correct full-task execution or atom-worker outcomes. It is a necessary but insufficient prerequisite for changing the pack builder.

## Frozen-in-branch DEV inputs

- `tasks.json`: 30 synthetic, intentionally non-sensitive instructions in six domains (five cases each): education, finance, software, operations, governance and research. **These are public development examples, not an independent blind holdout.**
- `gold.dev.json`: 80 source-span annotations (`action`, `prohibition`, `condition`, `approval`, `uncertainty`). Gold is never read by model calls. It is only loaded by `validate` and `score`.
- No results have been fabricated. When the Ollama model is not installed, only deterministic validation/unit tests can run.

## Four predeclared experimental arms

| Arm | Model request(s) | Core difference |
| --- | --- | --- |
| A: Whole | One single-pass interpretation prompt | Direct whole-instruction baseline; no agents |
| B: Atomization | One decomposition prompt | Split operations while retaining constraints |
| C: Dual representation | Two **independent** source-only passes: shape then meaning | Deterministic intersection of **kind + exact quote**; disagreement is not promoted |
| D: Dual + probe | Same as C, plus one separate gap-proposal pass | Only `hypothesis` candidates; probes cannot add asserted source spans |

All arms use the **same response field vocabulary, identical model identifier, temperature 0 and max tokens/request**. This does NOT equalize total request counts, total token budgets or latency. In particular D makes three calls, C two, A/B one, and conservative intersection may reduce recall. Report call count, failures and outputs next to quality.

No arm uses production worker interfaces. No user/private texts, internet resources or legacy seed data are sent to a model by the lab.

## Execution

Node >= 22.18 and an optional local Ollama model. There are no new npm dependencies.

```sh
node experiments/decomposition/cli.ts validate
node --test tests/decomposition-lab.test.ts
# Only once Ollama runs locally with the required model:
EAI_DECOMP_MODEL=qwen2.5:7b node experiments/decomposition/cli.ts run A /tmp/eai-decomp-A.json
EAI_DECOMP_MODEL=qwen2.5:7b node experiments/decomposition/cli.ts run B /tmp/eai-decomp-B.json
EAI_DECOMP_MODEL=qwen2.5:7b node experiments/decomposition/cli.ts run C /tmp/eai-decomp-C.json
EAI_DECOMP_MODEL=qwen2.5:7b node experiments/decomposition/cli.ts run D /tmp/eai-decomp-D.json
node experiments/decomposition/cli.ts score /tmp/eai-decomp-A.json /tmp/eai-score-A.json
# Repeat score for B, C, D.
```

The CLI writes output files exclusively (refuses overwrites). Failed model requests are explicit `failure` rows. Errors are **not** silently treated as correct "unknown" results. The Ollama adapter sends requests only to `127.0.0.1`, not a public endpoint. `EAI_DECOMP_TIMEOUT_MS` changes the per-call timeout; pin this and hardware before comparisons. Scores are **not probabilities**.

## How to read results

The deterministic score compares `kind + exact unique quote` to source-located reference annotations:
- source-span precision and recall on structurally valid cases;
- per-kind matches and misses, especially prohibitions and approvals;
- invalid/timeout case count and total gold coverage, **not** a zero accuracy substitution;
- total calls, reported generated tokens and observed wall time.

**This scorer cannot prove semantic correctness**: a longer/shorter but equivalent quotation is marked different, reference annotations can be wrong, and it does not validate true dependency edges, actor authority, legal compliance, hallucinated implications, or task outcomes. A blind human adjudication of action correctness, missing conditions and unjustified execution permissions is required before making architectural claims. Freeze the rubric and independent unseen holdout first.

## Non-negotiable trust boundary

An LLM may **propose** an interpretation but never marks it as formally supported. Candidate hypotheses (`status:hypothesis`) may not be promoted through repetition or consensus. C/D only assert exact-kind/exact-span agreement; even that is **not independent evidence**, since both passes may share model biases. Source anchoring proves a quote exists, **not that its interpretation follows**. No legacy TTL can delete explicit user prohibitions or approvals.

## Decision gate (not automatic)

Consider a later prototype outside production only when an independent reviewer finds measurable fewer lost conditions and unsafe inferred permissions on a separately frozen holdout. Include confidence intervals, false-positive cost, latency and throughput, reproducible model versions and the cost of incorrect abstentions. If C/D are not better than A/B, do not add the extra architecture.

References: `docs/worker-isolation.md`, `docs/atom-vs-whole-comparison.md`, `docs/frozen-cross-domain-validation.md`. These existing tests ask a **different** question (fact checks within already specified atoms); do not interpret them as validating this decomposition lab.

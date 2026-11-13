# Live Ollama smoke test

This test runs three isolated workers against a real Ollama model when started explicitly. The first-product-proof workflow runs a separate, required real coding-model test on every pull request and main push. A missing Ollama model fails that product proof instead of falling back to prepared answers.

## Prerequisites

- Node.js 22.18 or newer
- Ollama running on the same machine
- An installed Ollama model that follows instructions and returns JSON probabilities

## Run

```sh
ollama pull qwen2.5:1.5b
EAI_LIVE_OLLAMA_MODEL=qwen2.5:1.5b node --test tests/ollama-live-smoke.test.ts
```

If Ollama listens on a different loopback port, set `EAI_LIVE_OLLAMA_HOST=http://127.0.0.1:PORT`.

The test executes three concurrent isolated workers. Each worker gets a distinct question and one authorized source fragment. It checks that model outputs are valid distributions, but **does not independently inspect the actual HTTP requests**. For request-level isolation use `tests/ollama-sandbox-integration.test.ts`.

The code-product test bounds the synthetic example to 1536 generated tokens and prewarms the actual model on CI. A timeout or incomplete JSON fails the proof. Other local code tasks retain their normal token budget. No code is replaced by a canned answer.

## Interpretation

- The normal CI test covers HTTP transport and request isolation using a local simulated Ollama endpoint.
- This opt-in test checks a real local model's response compatibility and concurrent execution.
- Neither test proves security against a compromised host or model, nor establishes output correctness or evidentiary authority.
- Never use real student, employee, or customer data in smoke tests.

If the test fails, capture the model name, Ollama version, error category, and whether the failure was parsing, timeout, or connectivity. Do not upload private prompts or API keys.

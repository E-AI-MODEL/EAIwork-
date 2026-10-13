import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverLocalOllamaModels, ollamaProvider } from "../packages/gateway/src/ollama-provider.ts";
import { executeAtomWorker } from "../packages/gateway/src/gateway.ts";

const model = process.env.EAI_LIVE_OLLAMA_MODEL;
const host = process.env.EAI_LIVE_OLLAMA_HOST ?? "http://127.0.0.1:11434";

test("opt-in real Ollama: three isolated workers, no cross-atom context", { skip: !model }, async () => {
  const models = await discoverLocalOllamaModels(host, 10000);
  assert.ok(models.includes(model!), "Requested live model is not installed: " + model);
  const provider = ollamaProvider({ model: model!, host, timeoutMs: 120000, disableThinking: true });
  const questions = [
    "Is the supplied evidence sufficient to approve the blue item?",
    "Is the supplied evidence sufficient to approve the amber item?",
    "Is the supplied evidence sufficient to approve the violet item?",
  ];
  const atoms = questions.map((question, i) => ({
    id: "private.atom." + i,
    question,
    type: "yesno",
    worker: { sources: ["private:" + i], max_context_items: 1, max_context_chars: 150 },
  }));
  const results = await Promise.all(atoms.map((atom, i) =>
    executeAtomWorker(provider, atom as any, {}, {
      read: handle => {
        assert.equal(handle, "private:" + i);
        return ["Evidence for item " + i + " only. No verified approval record."];
      },
    }),
  ));
  assert.equal(results.length, 3);
  for (const result of results) {
    assert.ok(["yes", "no", "unknown"].includes(result.value));
    assert.ok(Object.values(result.probabilities).every(x => Number.isFinite(x) && x >= 0 && x <= 1));
    assert.ok(Math.abs(Object.values(result.probabilities).reduce((a, b) => a + b, 0) - 1) < 0.00001);
  }
  console.log("LIVE_OLLAMA_SMOKE_PASS", JSON.stringify({ model, workers: results.length, routes: results.map(r => r.route) }));
});

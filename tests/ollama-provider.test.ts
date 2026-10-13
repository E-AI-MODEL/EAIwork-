import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverLocalOllamaModels, localOllamaHost, ollamaProvider } from "../packages/gateway/src/ollama-provider.ts";

test("remote and credential-bearing Ollama hosts are blocked", () => {
  for (const host of ["https://example.org:11434", "http://192.168.1.3:11434", "http://user:pass@localhost:11434", "http://localhost:11434/other", "http://localhost:11434?x=1"]) {
    assert.throws(() => localOllamaHost(host));
  }
  assert.equal(localOllamaHost(), "http://127.0.0.1:11434");
});

test("Ollama provider sends only its capsule and falls back on unsupported think flag", async () => {
  const oldFetch = globalThis.fetch;
  const requests: any[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      if (body.think === false) return new Response("model does not support thinking", { status: 400 });
      return Response.json({ message: { content: '{"yes":0.8,"no":0.1,"unknown":0.1}' } });
    };
    const provider = ollamaProvider({ model: "fixture", disableThinking: true });
    const session = await provider.openSession();
    const capsule = { question: "Is this ready?", options: ["yes", "no", "unknown"], inputs: {}, context: ["allowed snippet"] };
    const result = await session.answer(capsule);
    assert.equal(result.yes, 0.8);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].think, false);
    assert.equal(requests[1].think, undefined);
    assert.equal(requests[0].messages.length, 1);
    assert.equal(requests[0].messages[0].role, "user");
    assert.deepEqual(JSON.parse(requests[0].messages[0].content).context, ["allowed snippet"]);
    await assert.rejects(() => session.answer(capsule), /already used/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("Ollama model discovery returns sorted unique installed models", async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ models: [{ name: "z" }, { name: "a" }, { name: "a" }] });
    assert.deepEqual(await discoverLocalOllamaModels(), ["a", "z"]);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

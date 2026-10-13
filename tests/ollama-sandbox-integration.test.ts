import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { executeAtomWorker } from "../packages/gateway/src/gateway.ts";
import { ollamaProvider, discoverLocalOllamaModels } from "../packages/gateway/src/ollama-provider.ts";

test("three isolated workers execute against a sandbox Ollama HTTP service", async () => {
  const received: any[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    if (req.url === "/api/tags") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ models: [{ name: "sandbox" }] }));
      return;
    }
    assert.equal(req.url, "/api/chat");
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    received.push(payload);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ message: { content: JSON.stringify({ yes: 0.7, no: 0.2, unknown: 0.1 }) } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const host = "http://127.0.0.1:" + address.port;
  try {
    assert.deepEqual(await discoverLocalOllamaModels(host), ["sandbox"]);
    const provider = ollamaProvider({ host, model: "sandbox" });
    const atoms = ["Alpha private", "Beta private", "Gamma private"].map((question, i) => ({
      id: "atom." + i, question, type: "yesno" as const,
      worker: { sources: ["source:" + i], max_context_items: 1, max_context_chars: 24 },
    }));
    const results = await Promise.all(atoms.map((atom, i) =>
      executeAtomWorker(provider, atom as any, {}, {
        read: handle => ["secret-" + handle, "not authorized second snippet"],
      }),
    ));
    assert.equal(results.length, 3);
    assert.equal(received.length, 3);
    for (let i = 0; i < atoms.length; i++) {
      const requests = received.filter(x => JSON.parse(x.messages[0].content).question === atoms[i].question);
      assert.equal(requests.length, 1);
      const message = JSON.parse(requests[0].messages[0].content);
      assert.deepEqual(Object.keys(message).sort(), ["context", "inputs", "instruction", "options", "question"]);
      assert.deepEqual(message.context, ["secret-source:" + i]);
      assert.equal(JSON.stringify(message).includes("not authorized"), false);
      assert.equal(JSON.stringify(message).includes("atom."), false);
      for (let j = 0; j < atoms.length; j++) {
        if (i !== j) assert.equal(JSON.stringify(message).includes(atoms[j].question), false);
      }
      assert.equal(results[i].value, "yes");
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

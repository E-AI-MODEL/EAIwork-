import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ollamaProvider, OllamaOutputError, discoverLocalOllamaModels } from "../packages/gateway/src/ollama-provider.ts";
import { ollamaChat, type OllamaCallMetric } from "../packages/gateway/src/ollama-chat.ts";
import { localOllamaPlanningModel } from "../packages/operations/src/planner.ts";
import { ollamaWholeTaskProvider } from "../packages/evaluation/src/compare.ts";

const capsule = { question: "Private question", options: ["yes", "no", "unknown"], inputs: {}, context: ["PRIVATE_SOURCE"] };
const content = '{"yes":1,"no":0,"unknown":0}';

test("fallback shares one deadline and records both actual requests without content", async () => {
  const old = globalThis.fetch;
  const signals: AbortSignal[] = [];
  const metrics: OllamaCallMetric[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      signals.push(init!.signal!);
      assert.equal(init?.redirect, "error");
      if (signals.length === 1) return new Response("thinking unsupported PRIVATE_SOURCE", { status: 400 });
      return Response.json({ message: { content }, total_duration: 5000000, load_duration: 1000000,
        eval_count: 12, prompt_eval_count: 45, eval_duration: -1, prompt_eval_duration: "bad",
        thinking: "PRIVATE_REASONING", arbitrary: "PRIVATE_SOURCE" });
    };
    const provider = ollamaProvider({ model: "metrics-fallback", disableThinking: true, timeoutMs: 1000,
      onCall: m => { metrics.push(m); } });
    assert.equal((await provider.openSession().answer(capsule)).yes, 1);
    assert.equal(signals.length, 2);
    assert.equal(signals[0], signals[1]);
    assert.deepEqual(metrics.map(m => [m.attempt, m.outcome, m.status]), [[1, "http", 400], [2, "success", 200]]);
    assert.equal(metrics[1].total_duration, 5000000);
    assert.equal(metrics[1].eval_count, 12);
    assert.equal(metrics[1].eval_duration, undefined);
    assert.equal(metrics[1].prompt_eval_duration, undefined);
    assert.ok(metrics.every(m => m.elapsedMs >= 0 && Object.isFrozen(m)));
    assert.ok(!JSON.stringify(metrics).includes("PRIVATE"));
    // Capability cache suppresses the failed think negotiation on the next fresh session.
    await provider.openSession().answer(capsule);
    assert.equal(metrics[2].attempt, 1);
  } finally { globalThis.fetch = old; }
});

test("metrics retain invalid output and missing usage; observer errors never retry", async () => {
  const old = globalThis.fetch;
  const metrics: OllamaCallMetric[] = [];
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ message: { content: calls === 1 ? 'PRIVATE_INVALID' : content } });
    };
    const provider = ollamaProvider({ model: "metrics-output", onCall: m => { metrics.push(m); throw Error("observer"); } });
    await assert.rejects(() => provider.openSession().answer(capsule),
      e => e instanceof OllamaOutputError && e.code === "non-json");
    assert.equal((await provider.openSession().answer(capsule)).yes, 1);
    assert.equal(calls, 2);
    assert.equal(metrics[0].outcome, "invalid-response");
    assert.equal(metrics[0].outputIssue, "non-json");
    assert.equal(metrics[1].eval_count, undefined);
    assert.ok(!JSON.stringify(metrics).includes("PRIVATE"));
  } finally { globalThis.fetch = old; }
});

test("incomplete, oversized and malformed envelopes fail before contract parsing", async () => {
  const old = globalThis.fetch;
  try {
    for (const [envelope, issue] of [
      [{ message: { content }, done: false }, "incomplete-response"],
      [{ message: { content }, done_reason: "length" }, "incomplete-response"],
      [{ message: { content: { secret: "PRIVATE" } } }, "empty-content"],
      [null, "invalid-object"],
    ] as const) {
      globalThis.fetch = async () => Response.json(envelope);
      await assert.rejects(() => ollamaProvider({ model: "envelope" }).openSession().answer(capsule),
        e => e instanceof OllamaOutputError && e.code === issue);
    }
    let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(100001)); },
      cancel() { cancelled = true; },
    }));
    await assert.rejects(() => ollamaProvider({ model: "oversized" }).openSession().answer(capsule),
      e => e instanceof OllamaOutputError && e.code === "response-too-large");
    assert.equal(cancelled, true);
  } finally { globalThis.fetch = old; }
});

test("planner, revision and whole-task calls expose separate request metrics", async () => {
  const old = globalThis.fetch;
  const metrics: OllamaCallMetric[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(init?.redirect, "error");
      return Response.json({ message: { content: '{}' }, eval_count: 7 });
    };
    const onCall = (m: Readonly<OllamaCallMetric>) => { metrics.push(m); };
    const planner = localOllamaPlanningModel({ model: "fixture", onCall });
    await planner.propose("Make a draft");
    await planner.proposeRevision!({ originalInstruction: null, goal: "draft", currentRevision: 0,
      reason: "more work", existingTasks: [], existingPhases: null, sourceConstraints: [] });
    await ollamaWholeTaskProvider({ model: "fixture", onCall }).answerAll([]);
    assert.deepEqual(metrics.map(m => m.operation), ["plan", "revision", "whole-task"]);
    assert.ok(metrics.every(m => m.eval_count === 7));
  } finally { globalThis.fetch = old; }
});

test("real loopback transport refuses redirects and aborts while reading a delayed body", async () => {
  let targetRequests = 0;
  const target = createServer((_req, res) => { targetRequests++; res.end('{}'); });
  await new Promise<void>(r => target.listen(0, "127.0.0.1", r));
  const targetUrl = "http://127.0.0.1:" + (target.address() as AddressInfo).port;
  const timers: ReturnType<typeof setTimeout>[] = [];
  let redirectChat = true;
  const source = createServer((req, res) => {
    if (req.url === "/api/tags" || redirectChat) {
      res.writeHead(302, { location: targetUrl }); res.end(); return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.flushHeaders();
    timers.push(setTimeout(() => res.end(JSON.stringify({ message: { content } })), 500));
  });
  await new Promise<void>(r => source.listen(0, "127.0.0.1", r));
  const host = "http://127.0.0.1:" + (source.address() as AddressInfo).port;
  const metrics: OllamaCallMetric[] = [];
  try {
    await assert.rejects(() => discoverLocalOllamaModels(host));
    await assert.rejects(() => ollamaProvider({ host, model: "redirect" }).openSession().answer(capsule));
    redirectChat = false;
    await assert.rejects(() => ollamaChat({ host, model: "fixture", signal: AbortSignal.timeout(50),
      maxResponseBytes: 100000, operation: "atom-answer", onCall: m => { metrics.push(m); } }, {}, JSON.parse));
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0].outcome, "timeout");
    assert.equal(targetRequests, 0);
  } finally {
    timers.forEach(clearTimeout);
    source.closeAllConnections(); target.closeAllConnections();
    await Promise.all([new Promise<void>(r => source.close(() => r())), new Promise<void>(r => target.close(() => r()))]);
  }
});

test("overflowing probability totals are rejected and measured as invalid output", async () => {
  const old = globalThis.fetch;
  const metrics: OllamaCallMetric[] = [];
  try {
    globalThis.fetch = async () => Response.json({ message: {
      content: '{"yes":1e308,"no":1e308,"unknown":0}',
    } });
    const provider = ollamaProvider({ model: "overflow", onCall: m => { metrics.push(m); } });
    for (const method of ["answer", "propose"] as const) {
      if (method === "propose") globalThis.fetch = async () => Response.json({ message: {
        content: '{"probabilities":{"yes":1e308,"no":1e308,"unknown":0},"references":[]}',
      } });
      await assert.rejects(() => provider.openSession()[method]!(capsule),
        e => e instanceof OllamaOutputError && e.code === "invalid-probability");
    }
    assert.deepEqual(metrics.map(m => [m.outcome, m.outputIssue]),
      [["invalid-response", "invalid-probability"], ["invalid-response", "invalid-probability"]]);
  } finally { globalThis.fetch = old; }
});

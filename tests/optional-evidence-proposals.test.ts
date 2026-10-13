import { test } from "node:test";
import assert from "node:assert/strict";
import {
  executeAtomWorker, mockProvider, type AtomCapsule, type ModelProvider,
} from "../packages/gateway/src/gateway.ts";
import { OllamaOutputError, ollamaProvider } from "../packages/gateway/src/ollama-provider.ts";
import type { PackAtom } from "../packages/core/src/index.ts";

const source = "Approval signed for request Q-17 on 2026-10-12.";
const quote = "Approval signed for request Q-17";
const ref = { contextIndex: 0, start: 0, end: quote.length, quote };
const atom: PackAtom = {
  id: "a.review.approval",
  question: "Evaluate the local approval claim using the attached record.",
  type: "yesno",
  decision: { kind: "verify-claim", claim: "Request Q-17 was approved." },
  worker: { sources: ["s.private.approval"], max_context_items: 1, max_context_chars: 256 },
};
const broker = {
  read: (handle: string) => {
    assert.equal(handle, "s.private.approval");
    return [source, "NOT AUTHORIZED SECOND EXCERPT"];
  },
};
const model = (references = [ref]): ModelProvider => ({
  id: "model:strong",
  openSession: () => {
    let used = false;
    return {
      answer: async () => { throw Error("Default answer path should not run in evidence mode"); },
      propose: async (capsule: AtomCapsule) => {
        assert.equal(used, false);
        used = true;
        assert.deepEqual(Object.keys(capsule).sort(), ["context", "decision", "inputs", "options", "question"]);
        assert.deepEqual(capsule.context, [source]);
        assert.equal(JSON.stringify(capsule).includes("s.private.approval"), false);
        assert.equal(JSON.stringify(capsule).includes("a.review.approval"), false);
        return {
          probabilities: { yes: 0.95, no: 0.03, unknown: 0.02 },
          references,
        };
      },
    };
  },
});

test("strong model may propose a passage; valid anchor stays SEMANTICALLY UNVERIFIED", async () => {
  const result = await executeAtomWorker(model(), atom, {}, broker, { observeEvidence: true });
  assert.equal(result.value, "yes");
  assert.equal(result.route, "accept-as-assumption");
  assert.equal(result.evidence?.status, "observed");
  if (result.evidence?.status !== "observed") throw Error("missing observation");
  assert.equal(result.evidence.observation.observation, "ANCHORED_UNVERIFIED");
  assert.equal(result.evidence.observation.route, "SEMANTIC_REVIEW_REQUIRED");
  assert.equal(result.evidence.observation.semanticSupport, "NOT_EVALUATED");
  assert.equal(result.evidence.observation.authorityRaised, false);
  assert.equal(result.evidence.observation.checked.length, 1);
  assert.equal(result.evidence.observation.checked[0].handle, "local.0");
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(quote), false);
  assert.equal(serialized.includes(source), false);
  assert.equal(serialized.includes("s.private.approval"), false);
});

test("made-up citation fails, without changing the provisional model answer or promoting it", async () => {
  const bad = { ...ref, quote: "Approved by someone (invented)" };
  const result = await executeAtomWorker(model([bad]), atom, {}, broker, { observeEvidence: true });
  assert.equal(result.value, "yes");
  assert.equal(result.route, "accept-as-assumption");
  if (result.evidence?.status !== "observed") throw Error("no observer");
  assert.equal(result.evidence.observation.route, "ROUTE_TO_HUMAN");
  assert.equal(result.evidence.observation.rejected[0].issue, "QUOTE_MISMATCH");
  assert.equal(result.evidence.observation.authorityRaised, false);
});

test("a cross-context reference cannot escape its local excerpt", async () => {
  const invalid = { ...ref, contextIndex: 7 };
  const result = await executeAtomWorker(model([invalid]), atom, {}, broker, { observeEvidence: true });
  if (result.evidence?.status !== "observed") throw Error("no observer");
  assert.equal(result.evidence.observation.rejected[0].issue, "SOURCE_UNAUTHORIZED");
  assert.equal(result.evidence.observation.authorityRaised, false);
});

test("missing citations ask for a source without changing the model's answer", async () => {
  const result = await executeAtomWorker(model([]), atom, {}, broker, { observeEvidence: true });
  if (result.evidence?.status !== "observed") throw Error("no observer");
  assert.equal(result.evidence.observation.route, "ASK_FOR_SOURCE");
  assert.equal(result.value, "yes");
});

test("non-citation providers keep their old default path; requested evidence is reported unsupported", async () => {
  const provider = mockProvider("model:legacy", { yes: 0.9, no: 0.05, unknown: 0.05 });
  const legacy = await executeAtomWorker(provider, atom, {}, broker);
  assert.equal("evidence" in legacy, false);
  assert.equal(legacy.value, "yes");
  const optional = await executeAtomWorker(provider, atom, {}, broker, { observeEvidence: true });
  assert.equal(optional.value, legacy.value);
  assert.deepEqual(optional.evidence, { status: "provider-unsupported" });
});

test("choice/score reasoning never forced through a yes/no evidence gate", async () => {
  let proposed = false;
  const provider: ModelProvider = {
    id: "model:creative",
    openSession: () => ({
      answer: async () => ({ option1: 0.9, option2: 0.05, unknown: 0.05 }),
      propose: async () => {
        proposed = true;
        throw new Error("must not demand citation for non-verification task");
      },
    }),
  };
  const choice: PackAtom = {
    id: "a.creative",
    question: "Which alternative is more useful?",
    type: "choice",
    options: ["option1", "option2"],
    worker: { sources: ["s.private.approval"], max_context_items: 1, max_context_chars: 256 },
  };
  const result = await executeAtomWorker(provider, choice, {}, broker, { observeEvidence: true });
  assert.equal(result.value, "option1");
  assert.equal(proposed, false);
  assert.deepEqual(result.evidence, { status: "not-applicable" });
});

test("Ollama's rich proposal is opt-in, schema-bound and cannot see broker handles", async () => {
  const old = globalThis.fetch;
  const requests: any[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      if (body.format.properties.references) {
        return Response.json({ message: { content: JSON.stringify({
          probabilities: { yes: 0.9, no: 0.05, unknown: 0.05 },
          references: [ref],
        }) } });
      }
      return Response.json({ message: { content: '{"yes":0.9,"no":0.05,"unknown":0.05}' } });
    };
    const provider = ollamaProvider({ model: "fixture-strong" });
    const legacy = await executeAtomWorker(provider, atom, {}, broker);
    assert.equal(legacy.evidence, undefined);
    assert.deepEqual(requests[0].format.required, ["yes", "no", "unknown"]);
    const rich = await executeAtomWorker(provider, atom, {}, broker, { observeEvidence: true });
    assert.equal(rich.evidence?.status, "observed");
    assert.deepEqual(requests[1].format.required, ["probabilities", "references"]);
    assert.equal(requests[1].format.properties.references.maxItems, 12);
    const prompt = JSON.parse(requests[1].messages[0].content);
    assert.deepEqual(prompt.context, [source]);
    assert.ok(prompt.instruction.includes("zero-based"));
    assert.ok(!JSON.stringify(requests[1]).includes("s.private.approval"));
    assert.ok(!JSON.stringify(requests[1]).includes("a.review.approval"));
  } finally { globalThis.fetch = old; }
});

test("malformed rich proposal is rejected safely, not turned into a verified source", async () => {
  const old = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ message: {
      content: JSON.stringify({ probabilities: { yes: 1, no: 0, unknown: 0 }, references: "bad" }),
    } });
    await assert.rejects(
      () => executeAtomWorker(ollamaProvider({ model: "fixture" }), atom, {}, broker, { observeEvidence: true }),
      (e: unknown) => e instanceof OllamaOutputError && e.code === "invalid-object",
    );
  } finally { globalThis.fetch = old; }
});

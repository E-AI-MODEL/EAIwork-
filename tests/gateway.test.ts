import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAtomCapsule, executeAtomWorker, mockProvider } from "../packages/gateway/src/gateway.ts";
import { lintPack, type Pack, type PackAtom, type State } from "../packages/core/src/index.ts";

const atom: PackAtom = {
  id: "a.fin.017",
  question: "Is the budget approved by the budget holder?",
  type: "yesno",
  depends_on: ["a.fin.016"],
  worker: {
    runtime: "budget-worker",
    reads: [{ atom: "a.fin.016", as: "request_filed" }],
    sources: ["s.fin.approval"],
    max_context_items: 2,
    max_context_chars: 12,
  },
};

const state: State = {
  "a.fin.016": {
    value: "yes",
    evidence: [{ id: "secret-evidence", source: "hidden", observer: { kind: "person", id: "p" }, mode: "observed", lineage: "hidden", supports: true }],
    flags: [{ id: "hidden-flag", message: "hidden", by: { kind: "person", id: "p" } }],
    lowered: [],
  },
  "a.other": { value: "no", evidence: [], flags: [], lowered: [] },
};

test("atom capsule contains only local question, options, aliased values and bounded context", async () => {
  const requested: string[] = [];
  const broker = {
    read: async (handle: string) => {
      requested.push(handle);
      return handle === "s.fin.approval"
        ? ["approval=yes", "holder=J", "this must never be reached"]
        : ["GLOBAL PROJECT GOAL MUST NOT LEAK"];
    },
  };

  const capsule = await buildAtomCapsule(atom, state, broker);
  assert.deepEqual(Object.keys(capsule).sort(), ["context", "inputs", "options", "question"]);
  assert.deepEqual(capsule.inputs, { request_filed: "yes" });
  assert.deepEqual(capsule.context, ["approval=yes"]);
  assert.deepEqual(requested, ["s.fin.approval"]);

  const serialized = JSON.stringify(capsule);
  for (const forbidden of [
    "a.fin.017", "a.fin.016", "a.other", "budget-worker", "s.fin.approval",
    "secret-evidence", "hidden-flag", "cluster", "status", "lineage", "project",
  ]) assert.equal(serialized.includes(forbidden), false, forbidden);
});

test("provider sees the capsule, never the real atom identity or pack structure", async () => {
  let seen: any;
  const provider = mockProvider("model:blind", (capsule) => {
    seen = structuredClone(capsule);
    return { yes: 0.8, no: 0.1, unknown: 0.1, invented: 99 };
  });
  const broker = { read: async () => ["approved"] };

  const result = await executeAtomWorker(
    provider,
    atom,
    state,
    broker,
    { at: "2026-10-06", eventId: "ev1" },
  );

  assert.equal(result.event.type, "answer.proposed");
  assert.equal(result.event.atom, "a.fin.017");
  assert.equal(result.event.actor.id, "model:blind");
  assert.equal((result.event as any).value, "yes");
  assert.equal("invented" in result.probabilities, false);

  const visibleToProvider = JSON.stringify(seen);
  assert.equal(visibleToProvider.includes("a.fin.017"), false);
  assert.equal(visibleToProvider.includes("a.fin.016"), false);
  assert.equal(visibleToProvider.includes("budget-worker"), false);
  assert.equal(visibleToProvider.includes("s.fin.approval"), false);
});

test("pack lint rejects worker attempts to widen their own anatomical scope", () => {
  const bad: Pack = {
    pack: "worker-bad",
    version: "1",
    sources: [{ id: "s.allowed" }],
    clusters: [{ id: "c", title: "C", atoms: ["a.one", "a.two", "a.three"] }],
    atoms: [
      { id: "a.one", question: "one?", type: "yesno" },
      { id: "a.two", question: "two?", type: "yesno" },
      {
        id: "a.three", question: "three?", type: "yesno", depends_on: ["a.one"],
        worker: {
          runtime: "Bad Runtime",
          reads: [
            { atom: "a.two", as: "sibling" },
            { atom: "a.one", as: "Bad Alias" },
          ],
          sources: ["s.not-declared"],
          max_context_items: 99,
          max_context_chars: 100,
        },
      },
    ],
  };
  const errors = lintPack(bad).join("\n");
  assert.match(errors, /worker runtime/);
  assert.match(errors, /is not a declared dependency/);
  assert.match(errors, /worker read alias/);
  assert.match(errors, /worker source s.not-declared is not declared/);
  assert.match(errors, /max_context_items/);
  assert.match(errors, /max_context_chars/);
});


test("every atom execution opens a fresh single-use model session", async () => {
  let sessions = 0;
  let closes = 0;
  const provider = {
    id: "model:fresh",
    openSession: () => {
      sessions++;
      let used = false;
      return {
        answer: async () => {
          assert.equal(used, false);
          used = true;
          return { yes: 1, no: 0, unknown: 0 };
        },
        close: () => { closes++; },
      };
    },
  };
  const broker = { read: async () => ["approved"] };

  await executeAtomWorker(provider, atom, state, broker, { at: "2026-10-06", eventId: "ev-a" });
  await executeAtomWorker(provider, atom, state, broker, { at: "2026-10-06", eventId: "ev-b" });

  assert.equal(sessions, 2);
  assert.equal(closes, 2);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  agreement, coverage, derive, distribution, lintPack, propagate, replay, weakestLink, type Pack,
} from "../packages/core/src/index.ts";

const pack: Pack = JSON.parse(readFileSync(new URL("../packs/sow-demo/pack.json", import.meta.url), "utf8"));
const person = { kind: "person", id: "person:jan" } as const;

test("demo pack lints clean", () => assert.deepEqual(lintPack(pack), []));

test("lint finds duplicates, unknown deps, cycles, orphans, bad rules", () => {
  const bad: Pack = {
    pack: "x", version: "0", clusters: [{ id: "c", title: "C", atoms: ["a.one", "a.two"] }],
    atoms: [
      { id: "a.one", question: "q", type: "yesno", depends_on: ["a.two"] },
      { id: "a.two", question: "q", type: "yesno", depends_on: ["a.one", "a.ghost"] },
      { id: "a.one", question: "dup", type: "yesno" },
      { id: "a.orphan", question: "q", type: "choice" },
    ],
    rules: [{ id: "R", when: { atom: "a.nope", status: { gte: "prove" } }, then: {} }],
  };
  const e = lintPack(bad).join("\n");
  for (const needle of ["duplicate atom id a.one", "unknown atom a.ghost", "dependency cycle", "in no cluster", "at least 2 options", "rule R: unknown atom a.nope", "rule R: invalid status gte prove"])
    assert.match(e, new RegExp(needle));
});

test("per-atom validity: evidence older than valid_for_days stops counting", () => {
  const ev = [
    { id: "1", at: "2026-01-01", actor: person, type: "answer.proposed", atom: "a.fin.017", value: "yes" },
    { id: "2", at: "2026-01-01", actor: person, type: "evidence.attached", atom: "a.fin.017",
      evidence: { id: "e", source: "form", observer: person, mode: "observed", lineage: "o:1", supports: true } },
  ] as any;
  assert.equal(replay(ev, "2026-02-01", { "a.fin.017": 90 }).derived["a.fin.017"].status, "observed");
  const late = replay(ev, "2026-06-01", { "a.fin.017": 90 }).derived["a.fin.017"];
  assert.equal(late.status, "assumption");
  assert.deepEqual(late.expired, ["e"]);
});

test("dependency propagation, distribution and weakest link", () => {
  const ev = [
    { id: "1", at: "2026-10-01", actor: person, type: "answer.proposed", atom: "a.fin.017", value: "yes" },
    { id: "2", at: "2026-10-01", actor: person, type: "evidence.attached", atom: "a.fin.017",
      evidence: { id: "e", source: "form", observer: person, mode: "observed", lineage: "o:1", supports: true } },
  ] as any;
  const r = replay(ev, "2026-10-05");
  const shaky = propagate(pack, r.derived);
  assert.equal(shaky.length, 1);
  assert.equal(shaky[0].because, "a.fin.016");
  const dist = distribution(pack, r.derived);
  assert.equal(dist["c.fin.budget"].observed, 1);
  assert.equal(dist["c.fin.budget"].unknown, 1);
  const wl = weakestLink(pack, r.derived, ["a.fin.017"]);
  assert.deepEqual(wl.map((x) => x.atom), ["a.fin.016", "a.fin.017"]);
});

test("coverage notes are prompts, with a disclaimer", () => {
  const r = replay([], "2026-10-05");
  const c = coverage(pack, r.state, r.derived);
  assert.match(c.disclaimer, /not a guarantee/);
});

test("agreement: kappa 1 for identical, low for disagreement", () => {
  const same = agreement({ a: "yes", b: "no", c: "yes" }, { a: "yes", b: "no", c: "yes" });
  assert.equal(same.percent, 1);
  assert.equal(same.kappa, 1);
  const diff = agreement({ a: "yes", b: "no", c: "yes", d: "no" }, { a: "no", b: "yes", c: "yes", d: "no" });
  assert.equal(diff.percent, 0.5);
  assert.deepEqual(diff.disagreements, ["a", "b"]);
  assert.ok(diff.kappa < 0.5);
});



test("derive: unknown answer is its own status", () => {
  assert.equal(derive({ value: "unknown", evidence: [], flags: [] }, "2026-10-05").status, "unknown");
});

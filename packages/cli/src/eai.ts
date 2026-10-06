#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { agreement, coverage, distribution, lintPack, propagate, replay, runRules, weakestLink } from "../../core/src/index.ts";
import { Store } from "../../server/src/store.ts";
import { SignedFileAnchorVerifier, SignedFileAnchorWitness } from "../../server/src/witness.ts";

const [cmd, ...args] = process.argv.slice(2);
const now = process.env.EAI_NOW ?? new Date().toISOString().slice(0, 10);
const readJson = (f: string) => JSON.parse(readFileSync(f, "utf8"));
const readLog = (f: string) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const validFor = (p: any) => Object.fromEntries(p.atoms.filter((a: any) => a.valid_for_days).map((a: any) => [a.id, a.valid_for_days]));
const usage = `usage:
  eai lint-pack <pack.json>
  eai replay <pack.json> <events.jsonl>
  eai explain <pack.json> <events.jsonl> <atom>
  eai report <pack.json> <events.jsonl> [goal-atom,...]
  eai agree <answersA.json> <answersB.json>      (two observers, {atom: value})
  eai verify-local <data-dir>
  eai verify-log <data-dir> <witness-dir> <public-key.pem>
  eai bootstrap-witness <data-dir> <witness-dir> <private-key.pem> <public-key.pem>`;

if (cmd === "lint-pack") {
  const problems = lintPack(readJson(args[0]));
  problems.forEach((x) => console.log("PROBLEM", x));
  console.log(problems.length ? `${problems.length} problem(s)` : "pack ok");
  process.exit(problems.length ? 1 : 0);
} else if (cmd === "replay") {
  const p = readJson(args[0]);
  const r = replay(readLog(args[1]), now, validFor(p));
  for (const a of p.atoms) console.log(a.id.padEnd(12), (r.derived[a.id]?.status ?? "unknown").padEnd(11), a.question);
  for (const f of runRules(p.rules ?? [], r.state, r.derived)) console.log(`FLAG [${f.flag}] ${f.rule}: ${f.message}`);
  for (const x of propagate(p, r.derived)) console.log(`SHAKY ${x.message}`);
  for (const x of r.rejected) console.log(`REJECTED event ${x.id}: ${x.reason}`);
  console.log("checksum", r.checksum.slice(0, 12));
} else if (cmd === "explain") {
  const p = readJson(args[0]);
  const r = replay(readLog(args[1]), now, validFor(p));
  const d = r.derived[args[2]];
  console.log(args[2], "->", d?.status ?? "unknown");
  (d?.reasons ?? []).forEach((x) => console.log(" -", x));
  r.state[args[2]]?.evidence.forEach((e) => console.log(" evidence", e.id, `${e.observer.kind}/${e.mode}`, e.lineage));
} else if (cmd === "report") {
  const p = readJson(args[0]);
  const r = replay(readLog(args[1]), now, validFor(p));
  const dist = distribution(p, r.derived);
  for (const c of p.clusters) console.log(c.title.padEnd(14), Object.entries(dist[c.id]).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", "));
  const goals = (args[2] ?? "").split(",").filter(Boolean);
  if (goals.length) {
    console.log("\nweakest link for", goals.join(", "));
    weakestLink(p, r.derived, goals).forEach((x) => console.log(" ", x.status.padEnd(11), x.atom, x.question));
  }
  const cv = coverage(p, r.state, r.derived);
  cv.notes.forEach((x) => console.log("REVIEW", x));
  console.log("\nNothing flagged means not detected, not safe.");
} else if (cmd === "agree") {
  const r = agreement(readJson(args[0]), readJson(args[1]));
  console.log(`n=${r.n} agreement=${(r.percent * 100).toFixed(0)}% kappa=${r.kappa.toFixed(2)}`);
  r.disagreements.forEach((x) => console.log("  disagree on", x, "-> split the atom or rewrite the question"));
} else if (cmd === "verify-local") {
  const v = new Store(args[0]).verify();
  console.log(v.ok ? "local log intact" : `local log broken at seq ${v.badAt}`);
  process.exit(v.ok ? 0 : 1);
} else if (cmd === "verify-log") {
  if (args.length < 3) { console.error(usage); process.exit(2); }
  const verifier = new SignedFileAnchorVerifier(args[1], readFileSync(args[2], "utf8"));
  const v = new Store(args[0], verifier).verify();
  console.log(v.ok ? "log and witness intact" : `verification failed at seq ${v.badAt}: ${v.reason ?? "local chain mismatch"}`);
  process.exit(v.ok ? 0 : 1);
} else if (cmd === "bootstrap-witness") {
  if (args.length < 4) { console.error(usage); process.exit(2); }
  const witness = new SignedFileAnchorWitness(args[1], readFileSync(args[2], "utf8"), readFileSync(args[3], "utf8"));
  const v = new Store(args[0]).bootstrapWitness(witness);
  console.log(v.ok ? "witness bootstrapped" : `bootstrap failed at seq ${v.badAt}: ${v.reason ?? "local chain mismatch"}`);
  process.exit(v.ok ? 0 : 1);
} else { console.error(usage); process.exit(2); }

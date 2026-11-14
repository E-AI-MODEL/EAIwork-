/**
 * Guards against a test run that reports success without having tested anything.
 *
 * The candidate source is untrusted and runs in the same process as the test that imports it.
 * A candidate that replaces `assert.equal` with a no-op makes every named test pass with a
 * clean TAP summary, so the output check in docker-test-outcome.ts cannot see it.
 *
 * Two layers:
 * 1. HARNESS_PRELOAD is loaded with `--import` before any test or candidate code. It deep-freezes
 *    `node:assert`, `node:assert/strict` and `node:test`. However the candidate reaches those
 *    modules (static import, computed `import()`, `process.getBuiltinModule`, the Function
 *    constructor), changing them throws, so the test file fails instead of passing. This is the
 *    structural defense.
 * 2. harnessInterference() refuses the direct forms before Docker starts, with a readable reason.
 *    It is a fail-closed denylist and an early warning, not the defense: layer 1 does not depend on it.
 *
 * Neither layer is a sandbox against a determined adversary inside the process. A person still
 * reads the change before it is applied.
 */

/** File name of the preload inside the staged, read-only test directory. Candidate paths cannot start with a dot. */
export const HARNESS_PRELOAD_FILE = ".eaiwork-harness.mjs";

export const HARNESS_PRELOAD = `// EAIwork test harness guard. Loaded before any test or candidate code.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const deepFreeze = (value, seen = new Set()) => {
  if ((typeof value !== "object" && typeof value !== "function") || value === null || seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (d && "value" in d) deepFreeze(d.value, seen);
  }
  Object.freeze(value);
};
for (const id of ["node:assert", "node:assert/strict", "node:test"]) {
  deepFreeze(require(id));
  deepFreeze((await import(id)).default);
}
`;

const INTERFERENCE: [RegExp, string][] = [
  [/\bprocess\b/, "ends or manipulates the process"],
  [/(?:\bfrom|\bimport|\brequire)\s*\(?\s*["'`](?:node:)?(?:test|assert|assert\/strict|test\/reporters|child_process|worker_threads|vm|module)["'`]/, "imports the test harness or a process-control module"],
  [/\bimport\s*\(|\brequire\b|\bgetBuiltinModule\b/, "loads modules at run time"],
  [/\bglobalThis\b|\bglobal\b|\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(|\.\s*constructor\b|\[\s*["'`]constructor|\\u/, "reaches for the global object or evaluates code from strings"],
];

/** Why a non-test source may not run under the test harness, or null when nothing was found. */
export function harnessInterference(source: string): string | null {
  for (const [pattern, why] of INTERFERENCE) if (pattern.test(source)) return why;
  return null;
}

/**
 * Guards against a test run that reports success without having tested anything.
 *
 * The candidate source is untrusted and runs in the same process as the test that imports it.
 * A candidate that replaces `assert.equal` with a no-op makes every named test pass with a
 * clean TAP summary, so the output check in docker-test-outcome.ts cannot see it. A candidate
 * that ends the process early is caught there; this guard refuses both before anything runs. They are not a sandbox against a determined adversary inside the process:
 * a person still reads the change before it is applied.
 */

const INTERFERENCE: [RegExp, string][] = [
  [/\bprocess\s*(?:\?\.|\.)\s*(?:exit|reallyExit|abort|kill)\b|\bprocess\s*\[/, "ends or manipulates the process"],
  [/\bprocess\s*(?:\?\.|\.)\s*(?:stdout|stderr|exitCode|on|once|emit)\b/, "touches process output or exit handling"],
  [/(?:\bfrom|\bimport|\brequire)\s*\(?\s*["'`](?:node:)?(?:test|assert|assert\/strict|test\/reporters|child_process|worker_threads|vm|module)["'`]/, "imports the test harness or a process-control module"],
  [/\bglobalThis\b|\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/, "reaches for the global object or evaluates code from strings"],
];

/** Why a non-test source may not run under the test harness, or null when nothing was found. */
export function harnessInterference(source: string): string | null {
  for (const [pattern, why] of INTERFERENCE) if (pattern.test(source)) return why;
  return null;
}

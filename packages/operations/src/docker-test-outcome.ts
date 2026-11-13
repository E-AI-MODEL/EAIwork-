/** Read TAP emitted by node:test, not an arbitrary substring saying "# tests 1".
 * A file with no test() calls can itself be reported as one passing file by Node.
 * Such empty file-level subtests never count as executed checks.
 */
export function inspectNodeTestOutput(output: string, minimumNamedTests = 1) {
  const count = (field: string): number | null => {
    const matches = [...output.matchAll(new RegExp("^# " + field + " ([0-9]+)\\s*$", "gm"))];
    return matches.length ? Number(matches.at(-1)![1]) : null;
  };
  const tests = count("tests"), passed = count("pass"), failed = count("fail");
  const skipped = count("skipped"), cancelled = count("cancelled"), todo = count("todo");
  const names = [...output.matchAll(/^# Subtest: (.+)$/gm)].map(match => match[1].trim());
  const fileOnly = names.some(name => /(?:^|[/\\])[^/\\]+\.test\.[cm]?js$/.test(name));
  const testsExecuted = tests !== null && tests >= minimumNamedTests &&
    names.length >= minimumNamedTests && !fileOnly;
  return { testsExecuted, passed: testsExecuted && passed === tests &&
    failed === 0 && skipped === 0 && cancelled === 0 && todo === 0 };
}

/** A saved result from before the named-test gate cannot authorize application. */
import type {DockerTestResult} from "./docker-code-test.ts";
export function validSingleFilePass(result:DockerTestResult|undefined):boolean{
  return !!result && result.proofFormat==="tap-named-v2" &&
    result.runner==="docker-node-test-v1" && result.status==="passed" &&
    result.testsExecuted===true && result.exitCode===0 && result.timedOut===false &&
    typeof result.imageId==="string" && /^sha256:[a-f0-9]{64}$/.test(result.imageId);
}

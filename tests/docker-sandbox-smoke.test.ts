import {test} from "node:test";
import assert from "node:assert/strict";
import {runIsolatedNodeTest} from "../packages/operations/src/docker-code-test.ts";

test("real Docker node:test runs candidate in read-only networkless container",
  {skip:process.env.EAI_DOCKER_SMOKE!=="1"},async()=>{
    const testPath="tests/counter.test.js";
    const testSource='import {test} from "node:test";\nimport assert from "node:assert/strict";\nimport {count} from "../src/counter.js";\ntest("expected count",()=>assert.equal(count,2));\n';
    const input={candidatePath:"src/counter.js",
      candidateSource:"export const count = 2;\n",testPath,testSource};
    const passed=await runIsolatedNodeTest(input);
    assert.equal(passed.status,"passed",JSON.stringify(passed));
    assert.equal(passed.testsExecuted,true);
    assert.match(passed.imageId||"",/^sha256:[0-9a-f]{64}$/);
    assert.equal(passed.exitCode,0);
    const failed=await runIsolatedNodeTest({...input,candidateSource:"export const count = 3;\n"});
    assert.equal(failed.status,"failed",JSON.stringify(failed));
    assert.equal(failed.testsExecuted,true);
    assert.notEqual(failed.exitCode,0);
  });

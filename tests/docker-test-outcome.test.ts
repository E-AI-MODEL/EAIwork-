import {test} from "node:test";
import assert from "node:assert/strict";
import {inspectNodeTestOutput} from "../packages/operations/src/docker-test-outcome.ts";

const full = (...subtests: string[]) => [
  "TAP version 13",
  ...subtests.map((name,i)=>`# Subtest: ${name}\nok ${i+1} - ${name}`),
  `1..${subtests.length}`,`# tests ${subtests.length}`,"# suites 0",
  `# pass ${subtests.length}`,"# fail 0","# cancelled 0","# skipped 0","# todo 0"
].join("\n");

test("named tests, not just an empty test file, are required",()=>{
  assert.equal(inspectNodeTestOutput(full("calculates invoice")).passed,true);
  assert.equal(inspectNodeTestOutput(full("/work/tests/empty.test.js")).testsExecuted,false);
  assert.equal(inspectNodeTestOutput(full("first"),2).testsExecuted,false);
});
test("skipped, todo, failed or missing counts never produce a passing report",()=>{
  for(const s of [
    full("a").replace("# skipped 0","# skipped 1"),
    full("a").replace("# todo 0","# todo 1"),
    full("a").replace("# fail 0","# fail 1"),
    full("a").replace("# pass 1","# pass 0"),
    full("a").replace("# cancelled 0","# cancelled 1"),
    full("a").replace("# tests 1","")
  ])assert.equal(inspectNodeTestOutput(s).passed,false);
});

test("a historical successful-looking Docker report is not accepted",async()=>{
  const {validSingleFilePass}=await import("../packages/operations/src/docker-test-outcome.ts");
  assert.equal(validSingleFilePass({status:"passed",runner:"docker-node-test-v1",
    candidateSha256:"x",testSha256:"y",imageId:"sha256:"+"a".repeat(64),
    testsExecuted:true,exitCode:0,timedOut:false,output:full("test"),recordedAt:"2026-11-01"}),false);
});

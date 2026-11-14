import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {harnessInterference} from "../packages/operations/src/test-integrity.ts";
import {inspectNodeTestOutput} from "../packages/operations/src/docker-test-outcome.ts";
import {runIsolatedNodeTest} from "../packages/operations/src/docker-code-test.ts";
import {runIsolatedProjectSuite} from "../packages/operations/src/docker-project-suite.ts";

const TEST='import test from "node:test";\nimport assert from "node:assert/strict";\nimport {amount} from "../src/amount.js";\ntest("amount is 12",()=>assert.equal(amount,12));\n';
const runNodeTest=(candidate:string)=>{
  const dir=mkdtempSync(join(tmpdir(),"eai-integrity-"));
  try{
    mkdirSync(join(dir,"src"));mkdirSync(join(dir,"tests"));
    writeFileSync(join(dir,"package.json"),'{"type":"module"}');
    writeFileSync(join(dir,"src","amount.js"),candidate);
    writeFileSync(join(dir,"tests","amount.test.js"),TEST);
    const run=spawnSync(process.execPath,["--test","tests/amount.test.js"],{cwd:dir,encoding:"utf8",env:{PATH:process.env.PATH||""}});
    return {code:run.status,output:run.stdout+run.stderr};
  }finally{rmSync(dir,{recursive:true,force:true})}
};

test("a candidate that disables assert passes the TAP check with a wrong value; the guard refuses it first",()=>{
  const spoof='import assert from "node:assert/strict";\nassert.equal = () => {};\nexport const amount = 999;\n';
  const run=runNodeTest(spoof);
  // This is the hole the output check cannot see: named test, exit 0, clean summary, wrong answer.
  assert.equal(run.code,0);
  assert.deepEqual(inspectNodeTestOutput(run.output,1),{testsExecuted:true,passed:true});
  assert.ok(harnessInterference(spoof));
  // Honest code is unaffected.
  assert.equal(harnessInterference("export const amount = 12;\n"),null);
  assert.deepEqual(inspectNodeTestOutput(runNodeTest("export const amount = 12;\n").output,1),{testsExecuted:true,passed:true});
  assert.equal(inspectNodeTestOutput(runNodeTest("export const amount = 11;\n").output,1).passed,false);
});

test("candidate sources that reach into the process or the harness are refused; ordinary code is not",()=>{
  for(const source of [
    "process.exit(0);","process?.exit(0)","process['exit'](0)","process.exitCode=0","process.stdout.write('# pass 1')",
    'import assert from "node:assert/strict"; assert.equal=()=>{};',"import test from 'node:test'","const a=require('assert')",
    "globalThis.x=1","eval('1')","new Function('return 1')()",'import("node:child_process")',
  ]) assert.ok(harnessInterference(source),source);
  for(const source of [
    "export const amount = 12;\n","export function total(a,b){return a+b}\n",
    "// process the invoice and test the assertion\nexport const processed = true;\n",
    "export const exitCode = 3; export const testName = 'x'; export const label = 'assert';\n",
  ]) assert.equal(harnessInterference(source),null,source);
});

test("both Docker runners refuse an interfering candidate without starting Docker",async()=>{
  const single=await runIsolatedNodeTest({candidatePath:"src/amount.js",
    candidateSource:'import assert from "node:assert/strict";\nassert.equal=()=>{};\nexport const amount=999;\n',
    testPath:"tests/amount.test.js",testSource:TEST});
  assert.equal(single.status,"failed");
  assert.equal(single.testsExecuted,false);
  assert.equal(single.imageId,null);
  const suite=await runIsolatedProjectSuite({testPaths:["tests/a.test.js","tests/b.test.js"],files:[
    {path:"src/a.js",content:"export const a=1;\n"},{path:"src/b.js",content:"process.exit(0);\nexport const b=1;\n"},
    {path:"tests/a.test.js",content:TEST},{path:"tests/b.test.js",content:TEST}]});
  assert.equal(suite.status,"failed");
  assert.equal(suite.testsExecuted,false);
  assert.match(suite.output,/src\/b\.js/);
});

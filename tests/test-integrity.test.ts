import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {HARNESS_PRELOAD,HARNESS_PRELOAD_FILE,harnessInterference} from "../packages/operations/src/test-integrity.ts";
import {inspectNodeTestOutput} from "../packages/operations/src/docker-test-outcome.ts";
import {runIsolatedNodeTest} from "../packages/operations/src/docker-code-test.ts";
import {runIsolatedProjectSuite} from "../packages/operations/src/docker-project-suite.ts";

const TEST='import test from "node:test";\nimport assert from "node:assert/strict";\nimport {amount} from "../src/amount.js";\ntest("amount is 12",()=>assert.equal(amount,12));\n';
/** Runs one candidate under node:test on the host, exactly as the Docker runner invokes it, optionally without the guard. */
const runNodeTest=(candidate:string,guarded:boolean)=>{
  const dir=mkdtempSync(join(tmpdir(),"eai-integrity-"));
  try{
    mkdirSync(join(dir,"src"));mkdirSync(join(dir,"tests"));
    writeFileSync(join(dir,"package.json"),'{"type":"module"}');
    writeFileSync(join(dir,HARNESS_PRELOAD_FILE),HARNESS_PRELOAD);
    writeFileSync(join(dir,"src","amount.js"),candidate);
    writeFileSync(join(dir,"tests","amount.test.js"),TEST);
    const args=[...(guarded?["--import","./"+HARNESS_PRELOAD_FILE]:[]),"--test","--test-reporter=tap","tests/amount.test.js"];
    const run=spawnSync(process.execPath,args,{cwd:dir,encoding:"utf8",env:{PATH:process.env.PATH||""}});
    return {code:run.status,...inspectNodeTestOutput(run.stdout+run.stderr,1)};
  }finally{rmSync(dir,{recursive:true,force:true})}
};
const ATTACKS={
  "static import":'import assert from "node:assert/strict";\nassert.equal = () => {};\nexport const amount = 999;\n',
  "computed import":'const a=(await import("node:"+"assert/strict")).default; a.equal=()=>{};\nexport const amount = 999;\n',
  "getBuiltinModule":'const a=process.getBuiltinModule("assert/strict"); a.equal=()=>{};\nexport const amount = 999;\n',
  "Function constructor":'const F=(()=>{}).constructor; const p=F("return pro"+"cess")(); p.getBuiltinModule("assert/strict").equal=()=>{};\nexport const amount = 999;\n',
  "node:test patched":'const t=(await import("node:"+"test")).default; t.test=(n,f)=>{};\nexport const amount = 999;\n',
};

test("without the guard, every tampering route passes with a wrong value; with it, every one fails",()=>{
  for(const [name,source] of Object.entries(ATTACKS)){
    const open=runNodeTest(source,false);
    if(name!=="node:test patched"){
      // This is the hole the TAP check alone cannot see: named test, exit 0, wrong answer.
      assert.equal(open.code,0,name);
      assert.equal(open.passed,true,name);
    }
    const guarded=runNodeTest(source,true);
    assert.notEqual(guarded.code,0,name);
    assert.equal(guarded.passed,false,name);
  }
  // Honest code is unaffected by the guard, and a wrong honest value still fails.
  const honest=runNodeTest("export const amount = 12;\n",true);
  assert.equal(honest.code,0);
  assert.deepEqual({testsExecuted:honest.testsExecuted,passed:honest.passed},{testsExecuted:true,passed:true});
  assert.equal(runNodeTest("export const amount = 11;\n",true).passed,false);
});

test("the early denylist refuses the direct forms with a reason; ordinary code passes",()=>{
  for(const source of [...Object.values(ATTACKS),
    "process.exit(0);","process?.exit(0)","const p = process;","import test from 'node:test'","const a=require('assert')",
    "globalThis.x=1","global.x=1","eval('1')","new Function('return 1')()",'import("node:child_process")',
    "(()=>{})['constructor']('x')","const s='\\u0070';",
  ]) assert.ok(harnessInterference(source),source);
  for(const source of [
    "export const amount = 12;\n","export function total(a,b){return a+b}\n",
    "export class Invoice { constructor(total){ this.total = total; } }\n",
    "// sum the invoice lines\nexport const sum = (xs) => xs.reduce((a,b)=>a+b,0);\n",
    "export const exitCode = 3; export const label = 'assert';\n",
  ]) assert.equal(harnessInterference(source),null,source);
});

test("both Docker runners refuse an interfering candidate without starting Docker",async()=>{
  const single=await runIsolatedNodeTest({candidatePath:"src/amount.js",candidateSource:ATTACKS["computed import"],
    testPath:"tests/amount.test.js",testSource:TEST});
  assert.equal(single.status,"failed");
  assert.equal(single.testsExecuted,false);
  assert.equal(single.imageId,null);
  const suite=await runIsolatedProjectSuite({testPaths:["tests/a.test.js","tests/b.test.js"],files:[
    {path:"src/a.js",content:"export const a=1;\n"},{path:"src/b.js",content:ATTACKS.getBuiltinModule},
    {path:"tests/a.test.js",content:TEST},{path:"tests/b.test.js",content:TEST}]});
  assert.equal(suite.status,"failed");
  assert.equal(suite.testsExecuted,false);
  assert.match(suite.output,/src\/b\.js/);
});

import {test} from "node:test";
import assert from "node:assert/strict";
import {existsSync,readFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {checkCandidate,compareSource} from "../packages/operations/src/code-review.ts";

test("line comparison counts additions, removals and unchanged lines",()=>{
  const x=compareSource("alpha\nbeta\ngamma","alpha\nBETA\ngamma\ndelta");
  assert.equal(x.added,2);
  assert.equal(x.removed,1);
  assert.ok(x.lines.some(line=>line.kind==="same"&&line.text==="alpha"));
  assert.ok(x.lines.some(line=>line.kind==="added"&&line.text==="BETA"));
  assert.ok(x.lines.some(line=>line.kind==="removed"&&line.text==="beta"));
  assert.equal(x.truncated,false);
});
test("large proposal never returns unbounded diff output",()=>{
  const before=Array.from({length:2000},(_,i)=>"old:"+i).join("\n");
  const after=Array.from({length:2000},(_,i)=>"new:"+i).join("\n");
  const x=compareSource(before,after);
  assert.equal(x.truncated,true);
  assert.ok(x.lines.length<=120);
  assert.ok(x.added>=2000&&x.removed>=2000);
});
test("static checks reject broken JSON and JS, and do not execute valid JS",()=>{
  assert.equal(checkCandidate("config.json",'{"version":1}').status,"passed");
  assert.equal(checkCandidate("config.json",'{"version":}').status,"failed");
  assert.equal(checkCandidate("src/index.js","export const value = ;").status,"failed");
  assert.equal(checkCandidate("src/index.js","export const value = 2;").status,"passed");
  assert.equal(checkCandidate("src/index.ts","export const value:number = 2;").status,"not-checked");
  const dir=mkdtempSync(join(tmpdir(),"eaiwork-static-check-"));
  const target=join(dir,"must-not-run");
  try{
    const script='import {writeFileSync} from "node:fs"; writeFileSync('+JSON.stringify(target)+',"oops");';
    assert.equal(checkCandidate("src/unsafe.js",script).status,"passed");
    assert.equal(existsSync(target),false,"--check must never execute model-supplied code");
  }finally{rmSync(dir,{recursive:true,force:true})}
});

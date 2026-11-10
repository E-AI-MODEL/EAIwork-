import {test} from "node:test";
import assert from "node:assert/strict";
import {existsSync, mkdtempSync, rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {checkCodeSyntax} from "../packages/operations/src/code-preflight.ts";

test("JavaScript module syntax is parsed, not executed",()=>{
  const root=mkdtempSync(join(tmpdir(),"eai-code-preflight-"));
  const marker=join(root,"SHOULD_NOT_EXIST");
  try{
    const source='import {writeFileSync} from "node:fs";\nwriteFileSync('+
      JSON.stringify(marker)+', "unsafe");\nexport const value = 1;\n';
    const result=checkCodeSyntax("src/main.js",source);
    assert.equal(result.status,"passed");
    assert.equal(result.checker,"node-esm-syntax");
    assert.equal(result.testsExecuted,false);
    assert.equal(existsSync(marker),false);
    assert.match(result.replacementSha256,/^[a-f0-9]{64}$/);
    assert.equal(checkCodeSyntax("src/bad.js","export const broken = ;").status,"failed");
  }finally{rmSync(root,{recursive:true,force:true})}
});
test("TypeScript syntax is checked without evaluating generated functions",()=>{
  const valid=checkCodeSyntax("src/counter.ts","export const count: number = 2;\n");
  assert.equal(valid.status,"passed");
  assert.equal(valid.checker,"node-typescript-syntax");
  assert.equal(valid.testsExecuted,false);
  const invalid=checkCodeSyntax("src/counter.ts","export const count: number = ;");
  assert.equal(invalid.status,"failed");
});
test("JSON parsing catches malformed replacements and other languages do not claim tests",()=>{
  assert.equal(checkCodeSyntax("package.json",'{"scripts":{"test":"node --test"}}').status,"passed");
  assert.equal(checkCodeSyntax("package.json",'{"test":}').status,"failed");
  for(const filename of ["src/widget.jsx","src/widget.tsx","src/app.py","assets/view.html","README.md"]){
    const status=checkCodeSyntax(filename,"unrecognized replacement");
    assert.equal(status.status,"not-evaluated",filename);
    assert.equal(status.checker,"unsupported",filename);
    assert.equal(status.testsExecuted,false);
  }
});
test("oversized content is rejected before starting syntax check",()=>{
  assert.throws(()=>checkCodeSyntax("src/main.js","x".repeat(32769)),/Ongeldige code/);
});

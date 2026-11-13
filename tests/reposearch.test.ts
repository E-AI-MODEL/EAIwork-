import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {searchLocalRepository} from "../packages/operations/src/reposearch.ts";

test("RepoSearch returns bounded exact local provenance, never verifies good practices",()=>{
  const root=mkdtempSync(join(tmpdir(),"eai-repo-search-"));
  const privateFolder=mkdtempSync(join(tmpdir(),"eai-repo-private-"));
  try{
    mkdirSync(join(root,"src"));
    mkdirSync(join(root,"tests"));
    mkdirSync(join(root,".git","refs","heads"),{recursive:true});
    writeFileSync(join(root,".git","HEAD"),"ref: refs/heads/main\n");
    const revision="1".repeat(40);
    writeFileSync(join(root,".git","refs","heads","main"),revision+"\n");
    writeFileSync(join(root,"src","controller.ts"),"const lifecycle = 'worker ready';\n// worker not yet verified\n");
    writeFileSync(join(root,"tests","controller.test.ts"),"// worker ready should pass checked fixture\n");
    writeFileSync(join(root,"src","tokens.json"),'{"secret":"worker ready password"}');
    writeFileSync(join(privateFolder,"escape.ts"),"worker ready should never appear");
    symlinkSync(privateFolder,join(root,"src","outside"),"dir");
    const result=searchLocalRepository(root,"worker ready");
    assert.equal(result.revision,revision);
    assert.equal(result.rootLabel,root.split("/").at(-1));
    assert.equal(result.results.length,2);
    assert.ok(result.results.some(x=>x.path==="src/controller.ts" && x.line===1));
    assert.ok(result.results.every(x=>x.review==="candidate-not-verified"));
    assert.ok(result.results.every(x=>/^[a-f0-9]{64}$/.test(x.fileSha256)));
    assert.ok(result.results.every(x=>!x.excerpt.includes("password")&&!x.excerpt.includes("never appear")));
    assert.match(result.note,/no tests, licence or semantic correctness/);
    assert.deepEqual(searchLocalRepository(root,"missing pattern").results,[]);
    assert.throws(()=>searchLocalRepository(root," "),/query/);
    assert.throws(()=>searchLocalRepository(root,"x".repeat(121)),/query/);
    assert.throws(()=>searchLocalRepository(root,"worker",{maxFiles:0}),/limits/);
    assert.equal(searchLocalRepository(root,"worker",{maxResults:1}).results.length,1);
    assert.equal(searchLocalRepository(root,"worker",{maxResults:1}).truncated,true);
  }finally{
    rmSync(root,{recursive:true,force:true});
    rmSync(privateFolder,{recursive:true,force:true});
  }
});

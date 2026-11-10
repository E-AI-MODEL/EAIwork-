import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {OpsStore} from "../packages/operations/src/store.ts";
import type {OpsEvent,OpsActor} from "../packages/operations/src/registry.ts";

const h="a".repeat(64),k="b".repeat(64),t="c".repeat(64);
const person:OpsActor={kind:"person",id:"person:local-reviewer"};
const checker:OpsActor={kind:"check",id:"check:docker-code-test"};
const system:OpsActor={kind:"system",id:"system:legacy-code-import"};
const base={proposalId:"11223344-5566-4788-99aa-bbccddeeff00",path:"src/count.js",
  sourceSha256:h,replacementSha256:k,modelId:"ollama:test-local"};
const event=(action:"proposed"|"imported"|"tested"|"applied"|"restored",
  result:"review-required"|"legacy-unverified"|"passed"|"failed"|"unavailable"|"applied"|"restored",
  testSha256?:string)=>({type:"code.activity" as const,...base,action,result,...(testSha256?{testSha256}:{})});
const entry=(id:string,actor:OpsActor,e:OpsEvent)=>({id,actor,
  at:"2026-11-10T20:30:00Z",event:e});
test("code events replay without contents; action owner, hashes and order are verified",()=>{
 const dir=mkdtempSync(join(tmpdir(),"eaiwork-code-audit-"));let store:OpsStore|undefined;
 try{
   store=new OpsStore(dir);
   assert.throws(()=>store!.append(entry("missing",person,event("applied","applied"))),/recorded proposal/);
   assert.throws(()=>store!.append(entry("model-spoof",{kind:"system",id:"system:model"},event("proposed","review-required"))),/human decision/);
   store.append(entry("proposal",person,event("proposed","review-required")));
   assert.throws(()=>store!.append(entry("fake-test",person,event("tested","passed",t))),/trusted checker/);
   assert.throws(()=>store!.append(entry("wrong-hash",checker,{...event("tested","passed",t),replacementSha256:"d".repeat(64)})),/source mismatch/);
   store.append(entry("test",checker,event("tested","passed",t)));
   store.append(entry("apply",person,event("applied","applied")));
   assert.throws(()=>store!.append(entry("apply2",person,event("applied","applied"))),/pending proposal/);
   store.append(entry("restore",person,event("restored","restored")));
   assert.throws(()=>store!.append(entry("restore2",person,event("restored","restored"))),/applied proposal/);
   assert.equal(store.verify().ok,true);
   const tail=store.snapshot().history.filter(x=>x.event.type==="code.activity");
   assert.deepEqual(tail.map(x=>(x.event as any).action),["proposed","tested","applied","restored"]);
   assert.equal(JSON.stringify(tail).includes("export const"),false);
   store.close();store=undefined;
   const reopened=new OpsStore(dir);
   assert.equal(reopened.verify().entries,4);
   assert.equal(reopened.snapshot().history.at(-1)?.id,"restore");
   reopened.close();
 }finally{store?.close();rmSync(dir,{recursive:true,force:true})}
});
test("older code proposals can be imported without claiming their original creator",()=>{
 const dir=mkdtempSync(join(tmpdir(),"eaiwork-code-legacy-"));
 try{
   const store=new OpsStore(dir);
   store.append(entry("import",system,event("imported","legacy-unverified")));
   store.append(entry("apply",person,event("applied","applied")));
   store.append(entry("restore",person,event("restored","restored")));
   assert.equal(store.verify().ok,true);
   const all=store.snapshot().history;
   assert.equal(all[0].actor.kind,"system");
   assert.equal((all[0].event as any).result,"legacy-unverified");
   store.close();
 }finally{rmSync(dir,{recursive:true,force:true})}
});

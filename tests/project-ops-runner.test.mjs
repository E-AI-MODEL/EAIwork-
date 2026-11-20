import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {mkdtemp,mkdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {OpsStore} from "../packages/operations/src/store.ts";
import {runProjectCheck,projectCheckHistory} from "../packages/project-engine/src/ops-runner.mjs";
const emptyEnv={};
const fresh=()=>mkdtempSync(join(tmpdir(),"eaigit-ops-"));
test("EAIgit workers run real code checks, journal outcomes and keep human gate closed",async()=>{
 const root=fresh(),project=join(root,"project"),dir=join(root,"operations");
 let store;
 try{
  await mkdir(project);
  await writeFile(join(project,"index.html"),"<!doctype html><html><body>ok</body></html>");
  await writeFile(join(project,"ok.js"),"export const sum=(a,b)=>a+b;");
  await writeFile(join(project,"bad.js"),"function () {");
  store=new OpsStore(dir);
  const result=await runProjectCheck(store,project,{goal:"site",environment:emptyEnv});
  assert.equal(result.status,"needs-human-review");
  assert.deepEqual(result.executed,["inventory","syntax","report"]);
  assert.equal(result.results.syntax.failed,1);
  assert.equal(result.results.report.published,false);
  assert.equal(result.results.report.writes,false);
  assert.equal(result.results.report.status,"needs-fix");
  const checks=projectCheckHistory(store,result.runId);
  assert.deepEqual(checks.map(x=>x.step),["inventory","syntax","report"]);
  assert.deepEqual(checks.map(x=>x.status),["completed","needs-review","needs-review"]);
  assert.deepEqual(checks.map(x=>x.detailCode),["ok","syntax-findings","human-review"]);
  assert.ok(checks.every(x=>/^[a-f0-9]{64}$/.test(x.resultSha256)));
  assert.equal(JSON.stringify(checks).includes("function () {"),false);
  assert.equal(store.verify().ok,true);
  store.close();store=new OpsStore(dir);
  assert.equal(projectCheckHistory(store,result.runId).length,3);
  const repeat=await runProjectCheck(store,project,{goal:"site",runId:result.runId,environment:emptyEnv});
  assert.deepEqual(repeat.executed,[]);
  assert.deepEqual(repeat.reused,["inventory","syntax","report"]);
  assert.equal(projectCheckHistory(store,result.runId).length,3);
  await writeFile(join(project,"ok.js"),"export const sum=()=>999;");
  const changed=await runProjectCheck(store,project,{goal:"site",runId:result.runId,environment:emptyEnv});
  assert.equal(changed.status,"blocked");
  assert.equal(changed.reason,"source-or-worker-result-changed");
  assert.equal(projectCheckHistory(store,result.runId).length,3);
 }finally{store?.close();rmSync(root,{recursive:true,force:true})}
});
test("failed inventory stays blocked until explicit read-only retry and preserves attempts",async()=>{
 const root=fresh(),project=join(root,"not-yet"),dir=join(root,"ops");
 const store=new OpsStore(dir);
 try{
  const runId="eaigit-explicit-retry-proof";
  const failed=await runProjectCheck(store,project,{runId,environment:emptyEnv});
  assert.equal(failed.status,"blocked");assert.equal(failed.failedStep,"inventory");
  const noRetry=await runProjectCheck(store,project,{runId,environment:emptyEnv});
  assert.equal(noRetry.reason,"explicit-retry-required");
  assert.equal(projectCheckHistory(store,runId).length,1);
  await mkdir(project);await writeFile(join(project,"index.html"),"<p>works</p>");
  const retried=await runProjectCheck(store,project,{runId,allowRetry:true,environment:emptyEnv});
  assert.equal(retried.status,"needs-human-review");
  assert.deepEqual(retried.executed,["inventory","syntax","report"]);
  assert.deepEqual(projectCheckHistory(store,runId).map(x=>x.attempt),[1,2,1,1]);
  assert.equal(store.verify().ok,true);
 }finally{store.close();rmSync(root,{recursive:true,force:true})}
});
test("operations reducer refuses forged project checks and out-of-order steps",()=>{
 const root=fresh(),store=new OpsStore(join(root,"ops"));
 const source={kind:"unbound",repository:null,commitSha:null};
 const event={type:"project.check.record",runId:"eaigit-reducer-proof",step:"report",
  status:"needs-review",attempt:1,source,resultSha256:"a".repeat(64),
  detailCode:"human-review",counts:{checked:0,failed:0,unknown:0}};
 try{
  const append=(actor,body)=>store.append({id:"evt-"+Math.random(),at:new Date().toISOString(),actor,event:body});
  assert.throws(()=>append({kind:"person",id:"p"},event),/trusted local engine actor/);
  assert.throws(()=>append({kind:"check",id:"check:eaigit-local"},event),/dependency not completed/);
  assert.throws(()=>append({kind:"check",id:"check:eaigit-local"},
   {...event,step:"inventory",status:"completed",detailCode:"ok",
    source:{kind:"github-actions-context",repository:"../../invalid",commitSha:"a".repeat(40)}}),/invalid project check source/);
  assert.equal(store.verify().ok,true);
  assert.equal(store.snapshot().history.length,0);
 }finally{store.close();rmSync(root,{recursive:true,force:true})}
});

test("existing EAIwork CLI runs project checks and prints only verified status",async()=>{
 const root=fresh(),project=join(root,"project"),dir=join(root,"operations");
 try{
  await mkdir(project);
  await writeFile(join(project,"index.html"),"<!doctype html><html><body>ok</body></html>");
  const cli=fileURLToPath(new URL("../packages/cli/src/eai.ts",import.meta.url));
  const run=spawnSync(process.execPath,[cli,"project-check",project,"site",dir],{
   encoding:"utf8",timeout:30000,env:{...process.env,GITHUB_REPOSITORY:"",GITHUB_SHA:""}
  });
  assert.equal(run.status,0,run.stderr||run.stdout);
  assert.match(run.stdout,/Status: needs-human-review/);
  assert.match(run.stdout,/Registraties: 3/);
  assert.match(run.stdout,/publicatie zijn niet uitgevoerd/);
  const store=new OpsStore(dir);
  try{
   assert.equal(store.verify().ok,true);
   assert.equal(store.snapshot().history.filter(x=>x.event.type==="project.check.record").length,3);
  }finally{store.close()}
 }finally{rmSync(root,{recursive:true,force:true})}
});

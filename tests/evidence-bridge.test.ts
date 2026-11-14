import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {openLocalProfile} from "../scripts/local-profile.ts";
import {LocalCodeWorkspace} from "../packages/operations/src/code-worker.ts";
import type {DockerTestResult,DockerTestInput} from "../packages/operations/src/docker-code-test.ts";
import {createDemoServer} from "../scripts/local-demo.ts";
import {appliedChanges,appliedChangesAreTested,CODE_TESTED_ATOM} from "../packages/operations/src/evidence-bridge.ts";
import {OpsStore} from "../packages/operations/src/store.ts";
import {randomUUID} from "node:crypto";

const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const row=(action:string,proposalId:string,path:string,replacementSha256:string,result:string)=>
  ({id:"x",at:"2026-11-13T00:00:00Z",actor:{kind:"person",id:"p"},
    event:{type:"code.activity",action,proposalId,path,sourceSha256:"0".repeat(64),replacementSha256,modelId:"m",result}}) as any;

test("the journal rule needs an applied change and a passing test for exactly the applied bytes",()=>{
  const A="a".repeat(64),B="b".repeat(64);
  assert.equal(appliedChangesAreTested([]),false,"no work is not proof of tested work");
  assert.equal(appliedChangesAreTested([row("tested","p1","src/a.js",A,"passed")]),false,"a test without an applied change proves nothing");
  const tested=[row("tested","p1","src/a.js",A,"passed"),row("applied","p1","src/a.js",A,"applied")];
  assert.equal(appliedChangesAreTested(tested),true);
  assert.equal(appliedChangesAreTested([row("tested","p1","src/a.js",A,"failed"),row("applied","p1","src/a.js",A,"applied")]),false);
  assert.equal(appliedChangesAreTested([row("tested","p1","src/a.js",B,"passed"),row("applied","p1","src/a.js",A,"applied")]),false,"other bytes were tested");
  assert.equal(appliedChangesAreTested([...tested,row("applied","p2","src/b.js",B,"applied")]),false,"one untested change breaks the claim");
  assert.equal(appliedChangesAreTested([...tested,row("restored","p1","src/a.js",A,"restored")]),false,"a restored change is no longer applied");
  assert.deepEqual(appliedChanges([...tested,row("applied","p2","src/b.js",B,"applied")]).map(x=>[x.path,x.tested]),
    [["src/a.js",true],["src/b.js",false]]);
});

test("recorded code work becomes proven evidence by itself, and the proof is withdrawn when it stops holding",async()=>{
  const root=mkdtempSync(join(tmpdir(),"eai-bridge-"));
  const work=join(root,"project"),profile=join(root,"profile");
  mkdirSync(join(work,"src"),{recursive:true});mkdirSync(join(work,"tests"),{recursive:true});
  writeFileSync(join(work,"src","counter.js"),"export const count = 1;\n");
  writeFileSync(join(work,"src","other.js"),"export const other = 1;\n");
  writeFileSync(join(work,"tests","counter.test.js"),
    'import {test} from "node:test";\nimport assert from "node:assert/strict";\nimport {count} from "../src/counter.js";\ntest("counter",()=>assert.equal(count,2));\n');
  openLocalProfile(profile);
  let reply="export const count = 2;\n";
  const fake=createServer(async(req,res)=>{
    for await(const _ of req){}
    res.setHeader("content-type","application/json");
    res.end(JSON.stringify({message:{role:"assistant",content:JSON.stringify({replacement:reply,explanation:"Kleine wijziging.",checks:["node:test"]})}}));
  });
  await new Promise<void>(ok=>fake.listen(0,"127.0.0.1",ok));
  const runner=async(input:DockerTestInput):Promise<DockerTestResult>=>({
    status:"passed",runner:"docker-node-test-v1",candidateSha256:hash(input.candidateSource),testSha256:hash(input.testSource),
    imageId:"sha256:"+"a".repeat(64),testsExecuted:true,exitCode:0,timedOut:false,proofFormat:"tap-named-v2",
    output:"# Subtest: counter\nok 1 - counter\n# tests 1\n# pass 1\n# fail 0",recordedAt:new Date().toISOString()} as DockerTestResult);
  const worker=new LocalCodeWorkspace({workspaceDir:work,profileDir:profile,
    host:"http://127.0.0.1:"+(fake.address() as AddressInfo).port,model:"local-test",testRunner:runner});
  const demo=createDemoServer({codeWorkspace:worker,persistentDir:profile,schedulerIntervalMs:0,seedDemoData:false});
  try{
    await new Promise<void>(ok=>demo.server.listen(0,"127.0.0.1",ok));
    const address="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
    const headers={Authorization:"Bearer "+demo.token,"content-type":"application/json"};
    const post=(route:string,body:unknown)=>fetch(address+route,{method:"POST",headers,body:JSON.stringify(body)});
    const get=async(route:string)=>(await fetch(address+route,{headers})).json() as Promise<any>;
    const atom=async()=>(await get("/state")).atoms[CODE_TESTED_ATOM];

    assert.equal((await atom()).status,"unknown","no recorded work, no claim");

    const draft=await(await post("/ops/code/propose",{path:"src/counter.js",instruction:"Set count to two",testPath:"tests/counter.test.js"})).json() as any;
    assert.equal((await post("/ops/code/test",{proposalId:draft.id})).status,200);
    assert.equal((await atom()).status,"unknown","a passing test on a change that is not applied proves nothing yet");
    assert.equal((await post("/ops/code/apply",{proposalId:draft.id,expectedSha256:draft.replacementSha256,approve:true})).status,200);

    let a=await atom();
    assert.equal(a.value,"yes");
    assert.equal(a.status,"proven");
    assert.equal(a.rule,"check-on-registered-source");
    let ex=await get("/explain/"+CODE_TESTED_ATOM);
    assert.deepEqual(ex.answeredBy,{kind:"system",id:"system:evidence-bridge"});
    assert.equal(ex.evidence.length,1);
    assert.equal(ex.evidence[0].observer.id,"check:operations-journal");
    assert.deepEqual(ex.evidence[0].basis.sources,["s.ops.journal"]);

    // A second change is applied without any test: the rule no longer holds and the proof is withdrawn.
    reply="export const other = 2;\n";
    const loose=await(await post("/ops/code/propose",{path:"src/other.js",instruction:"Set other to two"})).json() as any;
    assert.equal((await post("/ops/code/apply",{proposalId:loose.id,expectedSha256:loose.replacementSha256,approve:true})).status,200);
    a=await atom();
    assert.notEqual(a.status,"proven");
    ex=await get("/explain/"+CODE_TESTED_ATOM);
    assert.equal(ex.evidence.length,1,"the latest verdict replaces the earlier one");
    assert.equal(ex.evidence[0].supports,false);

    // Restoring the untested change makes the rule hold again; the proof returns without a person.
    assert.equal((await post("/ops/code/restore",{proposalId:loose.id,expectedSha256:loose.replacementSha256,approve:true})).status,200);
    a=await atom();
    assert.equal(a.status,"proven");
    assert.equal((await get("/log/verify")).ok,true);
  }finally{
    await demo.close();fake.close();
  }

  // Crash window: an untested change reached the operations journal, but the process stopped
  // before its check ran. The evidence journal still says proven. A restart must reconcile it.
  const ops=new OpsStore(openLocalProfile(profile).operationsDir);
  const proposalId=randomUUID(),person={kind:"person" as const,id:"person:demo"};
  const detail={proposalId,path:"src/other.js",sourceSha256:hash("export const other = 1;\n"),replacementSha256:hash("export const other = 3;\n"),modelId:"local-test"};
  for(const [action,result] of [["proposed","review-required"],["apply-started","pending"],["applied","applied"]] as const){
    ops.append({id:"ops-"+randomUUID(),at:new Date().toISOString(),actor:person,event:{type:"code.activity",action,...detail,result} as any});
  }
  ops.close();
  const again=createDemoServer({codeWorkspace:new LocalCodeWorkspace({workspaceDir:work,profileDir:profile,host:"http://127.0.0.1:1",model:"local-test",testRunner:runner}),
    persistentDir:profile,schedulerIntervalMs:0,seedDemoData:false});
  try{
    await new Promise<void>(ok=>again.server.listen(0,"127.0.0.1",ok));
    const address="http://127.0.0.1:"+((again.server.address() as AddressInfo).port);
    const state=await(await fetch(address+"/state",{headers:{Authorization:"Bearer "+again.token}})).json() as any;
    assert.notEqual(state.atoms[CODE_TESTED_ATOM].status,"proven","a proof that stopped holding does not survive a restart");
  }finally{
    await again.close();rmSync(root,{recursive:true,force:true});
  }
});

import {test} from "node:test";
import assert from "node:assert/strict";
import type {AddressInfo} from "node:net";
import {createHash} from "node:crypto";
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {OpsStore} from "../packages/operations/src/store.ts";
import {createDemoServer} from "../scripts/local-demo.ts";
import {applyOps,emptyOps,type OpsEnvelope} from "../packages/operations/src/registry.ts";

const plan=(id:string)=>({
  id,title:"Alleen aangewezen tekstworkers",goal:"Bewaar invoer bij gekozen uitvoerder",
  tasks:[{id:"task-text",title:"Opschonen",taskKind:"text-normalize",
    dependsOn:[],input:{text:"  Alleen  voor  deze  uitvoerder  "}}],
});
async function harness(){
  const demo=createDemoServer({schedulerIntervalMs:0});
  await new Promise<void>(resolve=>demo.server.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
  const request=(path:string,body:unknown={},token=demo.token)=>fetch(base+path,{
    method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},
    body:JSON.stringify(body),
  });
  const get=(path:string)=>fetch(base+path,{headers:{authorization:"Bearer "+demo.token}});
  return {demo,request,get};
}
test("remote-text consent requires a configured named executor and rejects accidental widening",async()=>{
  const h=await harness();
  try{
    const id="mission-scoped-contract";
    assert.equal((await h.request("/ops/missions",{plan:plan(id)})).status,201);
    const route="/ops/missions/"+id+"/automation/start";
    const remote={maxStarts:1,executionMode:"remote-text"};
    assert.equal((await h.request(route,remote)).status,422);
    assert.equal((await h.request(route,{...remote,executorIds:[]})).status,422);
    assert.equal((await h.request(route,{...remote,executorIds:["executor-unconfigured"]})).status,422);
    assert.equal((await h.request(route,{...remote,executorIds:["executor-local-demo","executor-local-demo"]})).status,422);
    assert.equal((await h.request(route,{...remote,executorIds:["executor-local-demo",42]})).status,422);
    assert.equal((await h.request(route,{maxStarts:1,executorIds:["executor-local-demo"]})).status,422);
    assert.equal((await h.request(route,{...remote,executorIds:["executor-local-demo"]})).status,201);
    const state=(await(await h.get("/ops/missions")).json() as any).missions[id];
    assert.deepEqual(state.automation.executorIds,["executor-local-demo"]);
    assert.equal(state.automation.starts,0);
    assert.equal((await h.request("/executor/v1/claim",{},h.demo.otherWorkerToken)).status,204);
    const claim=await h.request("/executor/v1/claim",{},h.demo.workerToken);
    assert.equal(claim.status,200);
    const job=await claim.json() as any;
    assert.equal(job.missionId,id);
    assert.equal(job.input.text,"  Alleen  voor  deze  uitvoerder  ");
    const ref={missionId:id,taskId:job.taskId,runId:job.runId,leaseId:job.leaseId};
    assert.equal((await h.request("/executor/v1/heartbeat",ref,h.demo.otherWorkerToken)).status,409);
    assert.equal((await h.request("/executor/v1/complete",
      {...ref,output:{text:"Alleen voor deze uitvoerder",changed:true}},
      h.demo.otherWorkerToken)).status,409);
    assert.equal((await h.request("/executor/v1/complete",
      {...ref,output:{text:"Alleen voor deze uitvoerder",changed:true}},
      h.demo.workerToken)).status,200);
    const result=(await(await h.get("/ops/missions")).json() as any).missions[id];
    assert.equal(result.tasks["task-text"].status,"done");
    assert.equal(result.automation.starts,1);
  }finally{await h.demo.close()}
});
test("two approved missions are isolated by executor identity",async()=>{
  const h=await harness();
  try{
    const a="mission-scoped-alpha",b="mission-scoped-beta";
    assert.equal((await h.request("/ops/missions",{plan:plan(a)})).status,201);
    assert.equal((await h.request("/ops/missions",{plan:plan(b)})).status,201);
    const start=(id:string,ids:string[])=>
      h.request("/ops/missions/"+id+"/automation/start",
        {maxStarts:1,executionMode:"remote-text",executorIds:ids});
    assert.equal((await start(a,["executor-local-demo"])).status,201);
    assert.equal((await start(b,["executor-other-demo"])).status,201);
    const beta=await h.request("/executor/v1/claim",{},h.demo.otherWorkerToken);
    assert.equal(beta.status,200);
    const betaJob=await beta.json() as any;
    assert.equal(betaJob.missionId,b);
    const alpha=await h.request("/executor/v1/claim",{},h.demo.workerToken);
    assert.equal(alpha.status,200);
    const alphaJob=await alpha.json() as any;
    assert.equal(alphaJob.missionId,a);
    assert.equal((await h.request("/executor/v1/claim",{},h.demo.otherWorkerToken)).status,204);
    const state=await(await h.get("/ops/missions")).json() as any;
    assert.deepEqual(state.missions[a].automation.executorIds,["executor-local-demo"]);
    assert.deepEqual(state.missions[b].automation.executorIds,["executor-other-demo"]);
    assert.equal(state.missions[a].tasks["task-text"].run.lease.ownerId,"executor-local-demo");
    assert.equal(state.missions[b].tasks["task-text"].run.lease.ownerId,"executor-other-demo");
    assert.equal((await h.get("/ops/verify")).status,200);
  }finally{await h.demo.close()}
});
test("legacy unscoped consent can replay but has no authority to lease input",()=>{
  const owner={kind:"person" as const,id:"person:legacy"};
  let state=emptyOps();
  const put=(id:string,event:OpsEnvelope["event"],actor:OpsEnvelope["actor"]=owner)=>{
    state=applyOps(state,{id,at:"2026-11-10T11:00:00Z",actor,event});
  };
  const id="mission-legacy-scope";
  put("create-legacy",{type:"mission.create",plan:plan(id)});
  put("consent-legacy",{type:"mission.automation.start",missionId:id,
    maxStarts:1,executionMode:"remote-text"});
  const m=state.missions[id];
  assert.deepEqual(m.automation?.executorIds,[]);
  assert.equal(m.automation?.starts,0);
  assert.throws(()=>put("lease-forged",{type:"task.lease.claim",missionId:id,
    taskId:"task-text",leaseId:"lease-synthetic",ownerId:"executor-local-demo",
    expiresAt:"2026-11-10T11:00:15Z",
    run:{runId:"run-synthetic",workerId:"text-normalize",
      workerVersion:"1.0.0",adapterId:"text-normalize",
      inputHash:"a".repeat(64),startedAt:"2026-11-10T11:00:00Z",
      verification:"not-evaluated"}},{kind:"system",id:"system:mission-runner"}),
    /approval for this executor/);
  assert.equal(state.missions[id].tasks["task-text"].status,"queued");
  assert.equal(state.missions[id].automation?.starts,0);
});

test("a verified old journal with an existing unscoped lease still opens, but cannot grant another claim",()=>{
  const dir=mkdtempSync(join(tmpdir(),"eai-legacy-executor-scope-"));
  const id="mission-legacy-durable";
  const original=plan(id);
  const expanded={...original,tasks:[...original.tasks,
    {id:"task-other",title:"Tweede tekst",taskKind:"text-normalize",
      dependsOn:[],input:{text:"  Ook  deze  tekst  "}}]};
  const person={kind:"person" as const,id:"person:legacy"};
  const runner={kind:"system" as const,id:"system:mission-runner"};
  const at="2026-11-10T11:00:00Z";
  const oldRun={runId:"run-prior-executor",workerId:"text-normalize",
    workerVersion:"1.0.0",adapterId:"text-normalize",inputHash:"a".repeat(64),
    startedAt:at,verification:"not-evaluated" as const};
  const events:OpsEnvelope[]=[
    {id:"legacy-created",at,actor:person,event:{type:"mission.create",plan:expanded}},
    {id:"legacy-consent",at,actor:person,event:{
      type:"mission.automation.start",missionId:id,maxStarts:2,executionMode:"remote-text",
    }},
    {id:"legacy-started",at,actor:runner,event:{
      type:"task.lease.claim",missionId:id,taskId:"task-text",
      leaseId:"lease-old",ownerId:"executor-local-demo",
      expiresAt:"2026-11-10T11:00:15Z",run:oldRun,
    }},
  ];
  try{
    let previous="0".repeat(64);
    const lines=events.map((payload,index)=>{
      const next=createHash("sha256").update(previous+JSON.stringify(payload)).digest("hex");
      const item={seq:index+1,prev:previous,hash:next,payload};
      previous=next;return JSON.stringify(item);
    });
    writeFileSync(join(dir,"worker-events.jsonl"),lines.join("\n")+"\n");
    writeFileSync(join(dir,"worker-events.head"),JSON.stringify({seq:3,hash:previous})+"\n");
    const store=new OpsStore(dir);
    const restored=store.snapshot().missions[id];
    assert.equal(restored.tasks["task-text"].status,"running");
    assert.equal(restored.tasks["task-text"].run?.lease?.id,"lease-old");
    assert.deepEqual(restored.automation?.executorIds,[]);
    assert.equal(restored.automation?.starts,1);
    assert.equal(store.verify().ok,true);
    assert.throws(()=>store.append({
      id:"new-unscoped-claim",at,actor:runner,event:{
        type:"task.lease.claim",missionId:id,taskId:"task-other",
        leaseId:"lease-new",ownerId:"executor-local-demo",
        expiresAt:"2026-11-10T11:00:15Z",
        run:{...oldRun,runId:"run-new-executor"},
      },
    }),/approval for this executor/);
    assert.equal(store.snapshot().history.length,3);
    store.close();
  }finally{rmSync(dir,{recursive:true,force:true})}
});

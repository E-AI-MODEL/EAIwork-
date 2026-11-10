import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {OpsStore} from "../packages/operations/src/store.ts";
import {LocalMissionScheduler} from "../packages/operations/src/scheduler.ts";
import {evaluateBuiltin} from "../packages/operations/src/execution.ts";
import type {OpsEvent,OpsActor,WorkerContract} from "../packages/operations/src/registry.ts";

const human:OpsActor={kind:"person",id:"person:operator"};
const check:OpsActor={kind:"check",id:"check:builtins"};
const runner:OpsActor={kind:"system",id:"system:mission-runner"};
const schedulerActor:OpsActor={kind:"system",id:"system:mission-scheduler"};
const contract=(id:"text-normalize"|"text-metrics"):WorkerContract=>({
  id,version:"1.0.0",name:id,specialization:"Fixed text worker",
  taskKinds:[id],inputSchema:{type:"object"},outputSchema:{type:"object"},
  tools:[],requestedPermissions:[],modelPolicy:{preferred:"deterministic"},
  testSuite:"builtin-fixture-v1",stopConditions:["bad-input"],
});
function setup(){
  const dir=mkdtempSync(join(tmpdir(),"eai-automatic-missions-"));
  let store=new OpsStore(dir);
  const append=(event:OpsEvent,actor:OpsActor=human)=>store.append({
    id:"scheduler-test-"+randomUUID(),at:new Date().toISOString(),actor,event,
  });
  const admit=(id:"text-normalize"|"text-metrics")=>{
    const c=contract(id);
    append({type:"worker.register",contract:c});
    const result=evaluateBuiltin(id,c);
    assert.equal(result.numerator,result.denominator);
    const evidenceRef="test:"+randomUUID();
    append({type:"quality.record",measurement:{
      id:"measurement-"+randomUUID(),workerId:id,version:c.version,
      taskKind:result.taskKind,dataset:result.dataset,suiteVersion:result.suiteVersion,
      cohort:result.cohort,metric:result.metric,numerator:result.numerator,
      denominator:result.denominator,measuredAt:new Date().toISOString(),evidenceRef,
    }},check);
    append({type:"worker.release",id,evidenceRef});
  };
  const plan=(id:string)=>({id,title:"Automatische lokale teksttaken",
    goal:"Werk twee afhankelijke teksttaken af, binnen toestemming en budget.",
    tasks:[
      {id:"task-clean",title:"Tekst opschonen",taskKind:"text-normalize",dependsOn:[],
        input:{text:"  Hallo  wereld  "}},
      {id:"task-count",title:"Woorden tellen",taskKind:"text-metrics",
        dependsOn:["task-clean"],textFrom:"task-clean"},
    ]});
  return {
    get store(){return store},
    reopen:()=>{store.close();store=new OpsStore(dir)},
    append,admit,plan,cleanup:()=>{store.close();rmSync(dir,{recursive:true,force:true})},
  };
}
test("one approved start is charged before execution; later tasks require a fresh human budget",()=>{
  const ctx=setup();
  try{
    ctx.admit("text-normalize");ctx.admit("text-metrics");
    ctx.append({type:"mission.create",plan:ctx.plan("mission-automatic")});
    let scheduler=new LocalMissionScheduler(ctx.store,0);
    assert.throws(()=>ctx.append({type:"mission.automation.start",missionId:"mission-automatic",maxStarts:0}),/budget/);
    assert.throws(()=>ctx.append({type:"mission.automation.start",missionId:"mission-automatic",maxStarts:33}),/budget/);
    assert.throws(()=>ctx.append({type:"mission.automation.start",missionId:"mission-automatic",maxStarts:1},runner),/person/);
    assert.throws(()=>ctx.append({type:"mission.automation.start",missionId:"mission-automatic",maxStarts:1},
      {kind:"person",id:"person:other"}),/creator/);
    ctx.append({type:"mission.automation.start",missionId:"mission-automatic",maxStarts:1});
    assert.throws(()=>ctx.append({type:"mission.automation.start",missionId:"mission-automatic",maxStarts:1}),/already active/);
    const first=scheduler.tick();
    assert.equal(first.started,1);
    assert.deepEqual(first.stopped,[{missionId:"mission-automatic",reason:"budget-exhausted"}]);
    let state=ctx.store.snapshot().missions["mission-automatic"];
    assert.equal(state.automation?.starts,1);
    assert.equal(state.automation?.enabled,false);
    assert.equal(state.automation?.approvedBy,"person:operator");
    assert.equal(state.tasks["task-clean"].status,"done");
    assert.equal(state.tasks["task-count"].status,"queued");
    assert.equal(scheduler.tick().started,0);
    ctx.append({type:"mission.automation.start",missionId:"mission-automatic",maxStarts:1});
    assert.deepEqual(scheduler.tick().stopped,[{missionId:"mission-automatic",reason:"complete"}]);
    state=ctx.store.snapshot().missions["mission-automatic"];
    assert.equal(state.tasks["task-count"].run?.output?.words,2);
    assert.equal(state.automation?.enabled,false);
    assert.equal(state.automation?.starts,1);
    assert.equal(state.automation?.stoppedReason,"complete");
    assert.equal(state.tasks["task-count"].run?.verification,"not-evaluated");
    assert.equal(ctx.store.verify().ok,true);
    scheduler.close();
  }finally{ctx.cleanup()}
});
test("startup disables outstanding approvals instead of running work after a restart",()=>{
  const ctx=setup();
  try{
    ctx.admit("text-normalize");
    ctx.append({type:"mission.create",plan:{...ctx.plan("mission-restart"),tasks:[ctx.plan("mission-restart").tasks[0]]}});
    ctx.append({type:"mission.automation.start",missionId:"mission-restart",maxStarts:1});
    ctx.reopen();
    const scheduler=new LocalMissionScheduler(ctx.store,0);
    assert.equal(ctx.store.snapshot().missions["mission-restart"].automation?.enabled,false);
    assert.equal(ctx.store.snapshot().missions["mission-restart"].automation?.stoppedReason,"interrupted");
    assert.equal(ctx.store.snapshot().missions["mission-restart"].tasks["task-clean"].status,"queued");
    assert.equal(scheduler.tick().started,0);
    scheduler.close();
    ctx.reopen();
    assert.equal(ctx.store.snapshot().missions["mission-restart"].automation?.stoppedReason,"interrupted");
  }finally{ctx.cleanup()}
});
test("automatic execution never runs external tasks or unknown adapters",()=>{
  const ctx=setup();
  try{
    ctx.append({type:"mission.create",plan:ctx.plan("mission-missing-worker")});
    const scheduler=new LocalMissionScheduler(ctx.store,0);
    ctx.append({type:"mission.automation.start",missionId:"mission-missing-worker",maxStarts:4});
    assert.deepEqual(scheduler.tick().stopped,[{missionId:"mission-missing-worker",reason:"blocked"}]);
    assert.equal(ctx.store.snapshot().missions["mission-missing-worker"].automation?.starts,0);
    assert.equal(ctx.store.snapshot().missions["mission-missing-worker"].tasks["task-clean"].status,"queued");
    const instruction="Publiceer pas na toestemming.";
    const quote="toestemming";
    const at=instruction.indexOf(quote);
    ctx.append({type:"mission.create",plan:{
      id:"mission-external",title:"Niet automatisch publiceren",goal:"Blokkeer externe acties",
      sourceInstruction:instruction,
      constraints:[{id:"gate-owner",kind:"approval",quote,start:at,end:at+quote.length,
        taskIds:["task-publish"],approverId:"person:operator"}],
      tasks:[{id:"task-publish",title:"Publiceer",taskKind:"publish",effect:"publish",
        dependsOn:[],input:{text:"concept"}}],
    }});
    assert.throws(()=>ctx.append({type:"mission.automation.start",missionId:"mission-external",maxStarts:1}),/local text workers/);
    assert.throws(()=>ctx.append({type:"mission.automation.stop",missionId:"mission-external",reason:"complete"}),/not active/);
    scheduler.close();
  }finally{ctx.cleanup()}
});
test("pause or explicit stop revokes authorization and cannot be forged by a model",()=>{
  const ctx=setup();
  try{
    ctx.admit("text-normalize");
    ctx.append({type:"mission.create",plan:{...ctx.plan("mission-stoppable"),tasks:[ctx.plan("mission-stoppable").tasks[0]]}});
    const scheduler=new LocalMissionScheduler(ctx.store,0);
    ctx.append({type:"mission.automation.start",missionId:"mission-stoppable",maxStarts:2});
    assert.throws(()=>ctx.append({type:"mission.automation.stop",missionId:"mission-stoppable",reason:"user-stopped"},
      {kind:"person",id:"person:other"}),/creator/);
    assert.throws(()=>ctx.append({type:"mission.automation.stop",missionId:"mission-stoppable",reason:"complete"},human),/own approval/);
    assert.throws(()=>ctx.append({type:"mission.automation.stop",missionId:"mission-stoppable",reason:"user-stopped"},
      {kind:"model",id:"model:planner"}),/invalid actor|trusted system actor/);
    ctx.append({type:"mission.pause",missionId:"mission-stoppable"});
    assert.equal(ctx.store.snapshot().missions["mission-stoppable"].automation?.stoppedReason,"paused");
    assert.equal(scheduler.tick().started,0);
    ctx.append({type:"mission.resume",missionId:"mission-stoppable"});
    assert.equal(scheduler.tick().started,0);
    ctx.append({type:"mission.automation.start",missionId:"mission-stoppable",maxStarts:1});
    ctx.append({type:"mission.automation.stop",missionId:"mission-stoppable",reason:"user-stopped"});
    assert.equal(scheduler.tick().started,0);
    assert.equal(ctx.store.snapshot().missions["mission-stoppable"].automation?.stoppedReason,"user-stopped");
    scheduler.close();
  }finally{ctx.cleanup()}
});


test("explicit restart consent preserves a bounded queue of not-yet-started local tasks",()=>{
  const ctx=setup();
  try{
    ctx.admit("text-normalize");ctx.admit("text-metrics");
    ctx.append({type:"mission.create",plan:ctx.plan("mission-restart-approved")});
    ctx.append({type:"mission.automation.start",missionId:"mission-restart-approved",
      maxStarts:2,resumeAfterRestart:true});
    ctx.reopen();
    const scheduler=new LocalMissionScheduler(ctx.store,0);
    assert.equal(ctx.store.snapshot().missions["mission-restart-approved"].automation?.enabled,true);
    assert.equal(ctx.store.snapshot().missions["mission-restart-approved"].automation?.starts,0);
    assert.equal(scheduler.tick().started,1);
    assert.deepEqual(scheduler.tick().stopped,[{missionId:"mission-restart-approved",reason:"complete"}]);
    const m=ctx.store.snapshot().missions["mission-restart-approved"];
    assert.equal(m.automation?.starts,2);
    assert.equal(m.tasks["task-count"].status,"done");
    assert.equal(m.automation?.stoppedReason,"complete");
    assert.equal(ctx.store.verify().ok,true);
    scheduler.close();
  }finally{ctx.cleanup()}
});
test("a restart never retries a possibly executed in-flight task, even with explicit consent",()=>{
  const ctx=setup();
  try{
    ctx.admit("text-normalize");
    const id="mission-inflight-restart";
    ctx.append({type:"mission.create",plan:{...ctx.plan(id),tasks:[ctx.plan(id).tasks[0]]}});
    ctx.append({type:"mission.automation.start",missionId:id,
      maxStarts:2,resumeAfterRestart:true});
    ctx.append({type:"task.started",missionId:id,taskId:"task-clean",run:{
      runId:"run-interrupted",workerId:"text-normalize",workerVersion:"1.0.0",
      adapterId:"text-normalize",inputHash:"a".repeat(64),
      startedAt:new Date().toISOString(),verification:"not-evaluated",
    }},runner);
    ctx.reopen();
    const scheduler=new LocalMissionScheduler(ctx.store,0);
    let m=ctx.store.snapshot().missions[id];
    assert.equal(m.automation?.enabled,false);
    assert.equal(m.automation?.stoppedReason,"needs-review");
    assert.equal(m.automation?.starts,1);
    assert.equal(m.tasks["task-clean"].status,"running");
    assert.equal(scheduler.tick().started,0);
    assert.equal(m.tasks["task-clean"].attempts?.length??0,0);
    ctx.append({type:"task.retry",missionId:id,taskId:"task-clean",
      reason:"Human checked that the local operation can safely be repeated"});
    m=ctx.store.snapshot().missions[id];
    assert.equal(m.tasks["task-clean"].status,"queued");
    assert.equal(m.tasks["task-clean"].attempts?.[0].runId,"run-interrupted");
    assert.equal(scheduler.tick().started,0);
    scheduler.close();
  }finally{ctx.cleanup()}
});
test("restart continuation consent must be an explicit boolean",()=>{
  const ctx=setup();
  try{
    ctx.admit("text-normalize");
    const id="mission-restart-bad-type";
    ctx.append({type:"mission.create",plan:{...ctx.plan(id),tasks:[ctx.plan(id).tasks[0]]}});
    assert.throws(()=>ctx.append({type:"mission.automation.start",missionId:id,maxStarts:2,
      resumeAfterRestart:"yes"} as any),/restart continuation consent/);
    assert.equal(ctx.store.snapshot().missions[id].automation,undefined);
  }finally{ctx.cleanup()}
});

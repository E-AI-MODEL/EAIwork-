import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {OpsStore} from "../packages/operations/src/store.ts";
import type {OpsEvent,OpsActor} from "../packages/operations/src/registry.ts";
import {buildMissionTrace} from "../packages/operations/src/trace.ts";
import {expireLocalLeases,expiredLocalLeases} from "../packages/operations/src/leases.ts";

const runner:OpsActor={kind:"system",id:"system:mission-runner"};
const human:OpsActor={kind:"person",id:"person:operator"};
const origin=Date.parse("2026-11-10T09:00:00Z");
const time=(offset:number)=>new Date(origin+offset).toISOString();
const plan={
  id:"mission-lease-test",title:"Leases controleren",goal:"Controleer claim en verlopen worker",
  tasks:[{id:"task-local",title:"Tekst",taskKind:"text-normalize",
    dependsOn:[],input:{text:"  Hallo  "}}],
};
const started={runId:"run-one",workerId:"text-normalize",workerVersion:"1.0.0",
  adapterId:"text-normalize",inputHash:"a".repeat(64),
  startedAt:time(0),verification:"not-evaluated" as const};
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),"eai-lease-"));
  let store=new OpsStore(dir);
  let seq=0;
  const put=(event:OpsEvent,actor:OpsActor=runner,at=time(0))=>
    store.append({id:"lease-event-"+(++seq),at,actor,event});
  put({type:"mission.create",plan},human);
  const claim=(overrides:Record<string,unknown>={})=>
    ({type:"task.lease.claim" as const,missionId:plan.id,taskId:"task-local",
      run:started,leaseId:"lease-one",ownerId:"local-subprocess",expiresAt:time(10000),
      ...overrides});
  return {get store(){return store},dir,put,claim,
    reopen(){store.close();store=new OpsStore(dir)},
    close(){store.close();rmSync(dir,{recursive:true,force:true})}};
}
test("lease survives restart, heartbeat extends expiry, and stale completion cannot commit",()=>{
  const f=fixture();
  try{
    f.put(f.claim());
    assert.throws(()=>f.put(f.claim({leaseId:"lease-other",run:{...started,runId:"run-two"}})),/already started/);
    f.reopen();
    const m=f.store.snapshot().missions[plan.id];
    assert.equal(m.tasks["task-local"].run?.lease?.id,"lease-one");
    assert.equal(m.tasks["task-local"].run?.lease?.ownerId,"local-subprocess");
    assert.throws(()=>f.put({type:"task.lease.renew",missionId:plan.id,taskId:"task-local",
      runId:"run-one",leaseId:"lease-one",ownerId:"other-owner",expiresAt:time(18000)},runner,time(3000)),/lease owner mismatch/);
    f.put({type:"task.lease.renew",missionId:plan.id,taskId:"task-local",
      runId:"run-one",leaseId:"lease-one",ownerId:"local-subprocess",
      expiresAt:time(18000)},runner,time(3000));
    assert.throws(()=>f.put({type:"task.lease.expire",missionId:plan.id,
      taskId:"task-local",runId:"run-one",leaseId:"lease-one"},runner,time(17000)),/has not expired/);
    const completed={type:"task.completed" as const,missionId:plan.id,taskId:"task-local",
      runId:"run-one",finishedAt:time(7000),elapsedMs:7000,
      output:{text:"Hallo",changed:true},outputHash:"b".repeat(64)};
    assert.throws(()=>f.put(completed),/stale task lease/);
    assert.throws(()=>f.put({...completed,leaseId:"lease-old"}),/stale task lease/);
    assert.throws(()=>f.put({...completed,leaseId:"lease-one",finishedAt:time(19000)}),/lease expired/);
    f.put({...completed,leaseId:"lease-one"},runner,time(7000));
    assert.equal(f.store.snapshot().missions[plan.id].tasks["task-local"].status,"done");
    assert.throws(()=>f.put({type:"task.lease.renew",missionId:plan.id,taskId:"task-local",
      runId:"run-one",leaseId:"lease-one",ownerId:"local-subprocess",
      expiresAt:time(25000)},runner,time(19000)),/stale task lease/);
    assert.equal(f.store.verify().ok,true);
    const trace=buildMissionTrace(f.store.snapshot(),plan.id);
    assert.equal(trace.tasks[0].attempts[0].leaseId,"lease-one");
    assert.equal(trace.tasks[0].attempts[0].status,"completed");
  }finally{f.close()}
});
test("expired lease fails closed, stays failed on restart and cannot accept late output",()=>{
  const f=fixture();
  try{
    f.put(f.claim());
    f.put({type:"task.lease.expire",missionId:plan.id,
      taskId:"task-local",runId:"run-one",leaseId:"lease-one"},runner,time(11000));
    let m=f.store.snapshot().missions[plan.id];
    assert.equal(m.tasks["task-local"].status,"failed");
    assert.equal(m.tasks["task-local"].run?.errorCode,"worker-unavailable");
    assert.throws(()=>f.put({type:"task.completed",missionId:plan.id,taskId:"task-local",
      runId:"run-one",leaseId:"lease-one",finishedAt:time(13000),elapsedMs:13000,
      output:{text:"Hallo"},outputHash:"a".repeat(64)}),/stale task result/);
    f.reopen();
    m=f.store.snapshot().missions[plan.id];
    assert.equal(m.tasks["task-local"].status,"failed");
    assert.equal(buildMissionTrace(f.store.snapshot(),plan.id).tasks[0].attempts[0].interruptionReason,"lease-expired");
    assert.equal(f.store.verify().ok,true);
    // Recovery remains the existing explicit human review, never automatic.
    f.put({type:"task.retry",missionId:plan.id,taskId:"task-local",
      reason:"Human verified the calculation has no side effects"},human,time(15000));
    m=f.store.snapshot().missions[plan.id];
    assert.equal(m.tasks["task-local"].status,"queued");
    assert.equal(m.tasks["task-local"].attempts?.[0].runId,"run-one");
    assert.throws(()=>f.put(f.claim()),/duplicate task run id/);
  }finally{f.close()}
});
test("lease claims are restricted to known pure adapters, short lifetimes and server actor",()=>{
  const f=fixture();
  try{
    assert.throws(()=>f.put(f.claim(),human),/server runner/);
    assert.throws(()=>f.put(f.claim({expiresAt:time(60000)})),/at most 30 seconds/);
    assert.throws(()=>f.put(f.claim({ownerId:"local bad"})),/invalid lease identity/);
    assert.throws(()=>f.put(f.claim({run:{...started,workerId:"unknown-worker"}})),/restricted to fixed/);
    f.put(f.claim());
    assert.throws(()=>f.put({type:"task.lease.renew",missionId:plan.id,taskId:"task-local",
      runId:"run-one",leaseId:"lease-one",ownerId:"local-subprocess",
      expiresAt:time(20000)},runner,time(10000)),/lease renewal denied/);
    assert.equal(f.store.snapshot().missions[plan.id].tasks["task-local"].run?.lease?.renewals,0);
  }finally{f.close()}
});

test("startup-style sweep expires only outdated leases and never repeats a job",()=>{
  const f=fixture();
  try{
    f.put(f.claim());
    f.reopen();
    assert.equal(expiredLocalLeases(f.store.snapshot(),origin+9999).length,0);
    assert.equal(expireLocalLeases(f.store,new Date(time(9999))),0);
    assert.equal(f.store.snapshot().missions[plan.id].tasks["task-local"].status,"running");
    assert.equal(expireLocalLeases(f.store,new Date(time(10000))),1);
    const state=f.store.snapshot();
    assert.equal(state.missions[plan.id].tasks["task-local"].status,"failed");
    assert.equal(state.history.filter(x=>x.event.type==="task.lease.expire").length,1);
    assert.equal(expireLocalLeases(f.store,new Date(time(11000))),0);
    f.reopen();
    assert.equal(f.store.snapshot().missions[plan.id].tasks["task-local"].status,"failed");
    assert.equal(f.store.verify().ok,true);
  }finally{f.close()}
});

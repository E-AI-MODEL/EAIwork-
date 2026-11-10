import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, emptyOps, type OpsEvent, type OpsActor } from "../packages/operations/src/registry.ts";

const person:OpsActor={kind:"person",id:"person:reviewer"};
const runner:OpsActor={kind:"system",id:"system:mission-runner"};
let seq=0;
const append=(state:ReturnType<typeof emptyOps>,event:OpsEvent,actor:OpsActor=person)=>
  applyOps(state,{id:"retry-case-"+(++seq),at:"2026-11-10T10:00:00Z",actor,event});
const plan=(id:string)=>({
  id,title:"Herstart zonder dubbel werk",goal:"Test gecontroleerd opnieuw uitvoeren",
  tasks:[{id:"task-clean",title:"Tekst normaliseren",taskKind:"text-normalize",dependsOn:[],
    input:{text:"Hallo  wereld"},effect:"local" as const}],
});
const started=(missionId:string,runId:string,workerId="text-normalize",adapterId=workerId)=>({
  type:"task.started" as const,missionId,taskId:"task-clean",run:{
    runId,workerId,workerVersion:"1.0.0",adapterId,
    inputHash:"a".repeat(64),startedAt:"2026-11-10T10:00:00Z",verification:"not-evaluated" as const,
  }
});
test("manual retry preserves prior unfinished attempt and never auto-reruns",()=>{
  const missionId="mission-safe";
  let state=append(emptyOps(),{type:"mission.create",plan:plan(missionId)});
  state=append(state,started(missionId,"run-first"),runner);
  assert.equal(state.missions[missionId].tasks["task-clean"].status,"running");
  assert.throws(()=>append(state,{type:"task.retry",missionId,taskId:"task-clean",reason:"reviewed"},runner),/person required/);
  state=append(state,{type:"task.retry",missionId,taskId:"task-clean",reason:"safe to repeat local transform"},person);
  let task=state.missions[missionId].tasks["task-clean"];
  assert.equal(task.status,"queued");
  assert.equal(task.attempts?.length,1);
  assert.equal(task.attempts?.[0].runId,"run-first");
  assert.equal(task.attempts?.[0].retryReview?.by,"person:reviewer");
  state=append(state,started(missionId,"run-second"),runner);
  state=append(state,{type:"task.completed",missionId,taskId:"task-clean",runId:"run-second",
    finishedAt:"2026-11-10T10:00:01Z",elapsedMs:1,
    output:{text:"Hallo wereld",changed:true},outputHash:"b".repeat(64)},runner);
  task=state.missions[missionId].tasks["task-clean"];
  assert.equal(task.status,"done");
  assert.equal(task.run?.runId,"run-second");
  assert.equal(task.attempts?.[0].runId,"run-first");
});
test("unknown adapter cannot be requeued without a side-effect contract",()=>{
  const missionId="mission-unsafe";
  let state=append(emptyOps(),{type:"mission.create",plan:plan(missionId)});
  state=append(state,started(missionId,"run-unknown","external-adapter","external-adapter"),runner);
  assert.throws(()=>append(state,{type:"task.retry",missionId,taskId:"task-clean",reason:"retry"},person),/known side-effect-free/);
});
test("a reviewed task has a bounded manual retry history",()=>{
  const missionId="mission-retries";
  let state=append(emptyOps(),{type:"mission.create",plan:plan(missionId)});
  for(let n=0;n<3;n++){
    state=append(state,started(missionId,"run-"+n),runner);
    state=append(state,{type:"task.retry",missionId,taskId:"task-clean",reason:"manual check "+n},person);
  }
  state=append(state,started(missionId,"run-fourth"),runner);
  assert.throws(()=>append(state,{type:"task.retry",missionId,taskId:"task-clean",reason:"unbounded"},person),/review limit/);
  assert.equal(state.missions[missionId].tasks["task-clean"].attempts?.length,3);
});

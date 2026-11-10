import {test} from "node:test";
import assert from "node:assert/strict";
import {applyOps,emptyOps,type OpsEnvelope,type OpsEvent} from "../packages/operations/src/registry.ts";
import {buildMissionTrace} from "../packages/operations/src/trace.ts";

test("mission trace preserves run attempts and distinguishes completion from evidence",()=>{
  let state=emptyOps(),sequence=0;
  const put=(event:OpsEvent,actor={kind:"person" as const,id:"person:operator"})=>{
    state=applyOps(state,{id:"trace-event-"+(++sequence),at:"2026-11-10T10:00:00Z",actor,event} as OpsEnvelope);
  };
  const missionId="mission-audit";
  put({type:"mission.create",plan:{id:missionId,title:"Controleer de uitvoer",goal:"Trace after interruption",tasks:[
    {id:"task-first",title:"Maak een tekst",taskKind:"text-normalize",dependsOn:[],input:{text:"Voorbeeld"}},
    {id:"task-next",title:"Volg de tekst",taskKind:"text-metrics",dependsOn:["task-first"],textFrom:"task-first"},
  ]}});
  const runner={kind:"system" as const,id:"system:mission-runner"};
  const started=(runId:string)=>({runId,workerId:"text-normalize",workerVersion:"1.0.0",
    adapterId:"text-normalize",inputHash:"f".repeat(64),startedAt:"2026-11-10T10:00:00Z",
    verification:"not-evaluated" as const});
  put({type:"task.started",missionId,taskId:"task-first",run:started("run-one1")},runner);
  put({type:"task.retry",missionId,taskId:"task-first",reason:"Operator checked: local, no external effects"});
  put({type:"task.started",missionId,taskId:"task-first",run:started("run-two2")},runner);
  put({type:"task.completed",missionId,taskId:"task-first",runId:"run-two2",
    finishedAt:"2026-11-10T10:00:02Z",elapsedMs:12,output:{text:"Voorbeeld"},
    outputHash:"c".repeat(64)},runner);
  const trace=buildMissionTrace(state,missionId);
  assert.equal(trace.schema,"eai-mission-trace-v1");
  assert.equal(trace.counts.tasks,2);
  assert.equal(trace.counts.attempts,2);
  assert.equal(trace.tasks[0].attempts[0].status,"interrupted");
  assert.equal(trace.tasks[0].attempts[1].status,"completed");
  assert.equal(trace.tasks[0].attempts[1].elapsedMs,12);
  assert.equal(trace.tasks[0].attempts[1].outputHash,"c".repeat(64));
  assert.equal(trace.tasks[0].verification,"not-evaluated");
  assert.equal(trace.tasks[1].blocker,null);
  assert.equal(trace.events.filter(x=>x.type==="task.started").length,2);
  assert.equal(trace.events.filter(x=>x.type==="task.retry").length,1);
  assert.equal(trace.tasks[0].attempts[1].cost,null);
  assert.equal(trace.tasks[0].attempts[1].tokens,null);
  assert.equal(JSON.stringify(trace).includes("Voorbeeld"),false);
  assert.throws(()=>buildMissionTrace(state,"mission-unknown"),/unknown mission/);
});

import {test} from "node:test";
import assert from "node:assert/strict";
import {applyOps,emptyOps,type OpsEvent,type OpsActor} from "../packages/operations/src/registry.ts";
import {missionProgress,type MissionPlan} from "../packages/operations/src/missions.ts";

const original="Maak een concept. Publiceer pas na schriftelijk akkoord.";
const quote="schriftelijk akkoord";
const at=original.indexOf(quote);
const base:MissionPlan={
  id:"mission-reviewable",title:"Concept en publicatie",goal:"Lever pas na goedkeuring",
  sourceInstruction:original,
  constraints:[{id:"gate-publish",kind:"approval",quote,start:at,end:at+quote.length,
    taskIds:["task-publish"],approverId:"person:rector"}],
  tasks:[
    {id:"task-draft",title:"Tekst maken",taskKind:"text-normalize",dependsOn:[],
      input:{text:"  Concept  "}},
    {id:"task-publish",title:"Publicatie",taskKind:"publish",effect:"publish",
      dependsOn:["task-draft"],input:{text:"Concept"}},
  ],
};
const person:OpsActor={kind:"person",id:"person:author"};
const rector:OpsActor={kind:"person",id:"person:rector"};
const system:OpsActor={kind:"system",id:"system:planner"};
let index=0;
const commit=(state:ReturnType<typeof emptyOps>,event:OpsEvent,actor:OpsActor=person)=>
  applyOps(state,{id:"extension-"+(++index),at:"2026-11-10T12:00:00Z",actor,event});
const extended=():MissionPlan=>({...base,
  tasks:[...base.tasks,{id:"task-new",title:"Nieuwe controletaak",taskKind:"text-metrics",
    dependsOn:["task-draft"],input:{text:"Concept"}}],
  constraints:[{...base.constraints![0],taskIds:["task-publish","task-new"]}],
});

test("human extension preserves old tasks, source and constraints; approvals are renewed",()=>{
  let state=commit(emptyOps(),{type:"mission.create",plan:base});
  state=commit(state,{type:"mission.gate.resolve",missionId:base.id,
    constraintId:"gate-publish",evidenceRef:"written:approval-1"},rector);
  assert.equal(state.missions[base.id].revision,1);
  assert.ok(state.missions[base.id].resolvedGates["gate-publish"]);
  state=commit(state,{type:"mission.extend",missionId:base.id,
    plan:extended(),expectedRevision:1});
  const mission=state.missions[base.id];
  assert.equal(mission.revision,2);
  assert.equal(mission.plan.sourceInstruction,original);
  assert.deepEqual(mission.plan.tasks.slice(0,2),base.tasks);
  assert.equal(mission.tasks["task-new"].status,"queued");
  assert.deepEqual(mission.resolvedGates,{});
  assert.equal(missionProgress(mission).blockedByConstraints,2);
  assert.equal(state.history.at(-1)?.event.type,"mission.extend");
  state=commit(state,{type:"mission.gate.resolve",missionId:base.id,
    constraintId:"gate-publish",evidenceRef:"written:approval-2"},rector);
  assert.equal(state.missions[base.id].resolvedGates["gate-publish"].evidenceRef,"written:approval-2");
});
test("stale, altered, missing and unauthorized extensions are refused",()=>{
  const state=commit(emptyOps(),{type:"mission.create",plan:base});
  const event=(plan:MissionPlan,expectedRevision=1):OpsEvent=>({
    type:"mission.extend",missionId:base.id,plan,expectedRevision,
  });
  assert.throws(()=>commit(state,event(extended(),0)),/stale mission plan revision/);
  assert.throws(()=>commit(state,event(extended()),system),/original human approver/);
  assert.throws(()=>commit(state,event(extended()),rector),/original human approver/);
  assert.throws(()=>commit(state,event({...extended(),sourceInstruction:original+" EXTRA"})),/original mission instruction/);
  assert.throws(()=>commit(state,event({...extended(),goal:"Ander doel"})),/original mission instruction/);
  assert.throws(()=>commit(state,event({...extended(),tasks:[...extended().tasks.slice(0,1),
    {...base.tasks[1],effect:"local"},extended().tasks[2]]})),/append tasks/);
  assert.throws(()=>commit(state,event({...extended(),constraints:[]})),/approval gate/);
  assert.throws(()=>commit(state,event({...extended(),constraints:base.constraints})),/constraint task targets|existing instruction constraints/);
  assert.equal(state.missions[base.id].revision,1);
});
test("active automation forbids re-planning until execution is stopped",()=>{
  const id="mission-local-extension";
  const plan:MissionPlan={
    id,title:"Lokale tekst",goal:"Controleer planwijzigingen",
    tasks:[{id:"task-clean",title:"Opschonen",taskKind:"text-normalize",
      dependsOn:[],input:{text:"Hallo"}}],
  };
  let state=commit(emptyOps(),{type:"mission.create",plan});
  state=commit(state,{type:"mission.automation.start",missionId:id,maxStarts:2,
    resumeAfterRestart:true});
  const next:MissionPlan={...plan,tasks:[...plan.tasks,
    {id:"task-count",title:"Tellen",taskKind:"text-metrics",
      dependsOn:["task-clean"],textFrom:"task-clean"}]};
  assert.throws(()=>commit(state,{type:"mission.extend",missionId:id,expectedRevision:1,
    plan:next}),/stop automatic or running/);
  state=commit(state,{type:"mission.automation.stop",missionId:id,reason:"user-stopped"});
  state=commit(state,{type:"mission.extend",missionId:id,expectedRevision:1,plan:next});
  assert.equal(state.missions[id].revision,2);
  assert.equal(state.missions[id].automation?.enabled,false);
  assert.equal(state.missions[id].tasks["task-count"].status,"queued");
});

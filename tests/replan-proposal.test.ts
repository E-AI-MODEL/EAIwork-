import {test} from "node:test";
import assert from "node:assert/strict";
import {proposeMissionRevision} from "../packages/operations/src/replan.ts";
import {applyOps,emptyOps,type OpsEvent,type OpsActor} from "../packages/operations/src/registry.ts";
import type {MissionPlan} from "../packages/operations/src/missions.ts";
import type {PlanningModel,ReplanContext} from "../packages/operations/src/planner.ts";

const instruction="Schrijf een concept. Publiceer pas na schriftelijke toestemming.";
const quote="schriftelijke toestemming";
const at=instruction.indexOf(quote);
const plan:MissionPlan={
  id:"mission-revision-candidate",title:"Concept en verzending",goal:"Bewaar alle afspraken",
  sourceInstruction:instruction,
  tasks:[
    {id:"task-draft",title:"Concept maken",taskKind:"text-normalize",
      dependsOn:[],input:{text:"  Concept  "}},
    {id:"task-publish",title:"Concept publiceren",taskKind:"publish",
      effect:"publish",dependsOn:["task-draft"],input:{text:"Concept"}},
  ],
  phases:[
    {id:"phase-draft",title:"Voorbereiding",taskIds:["task-draft"]},
    {id:"phase-publish",title:"Publicatie",taskIds:["task-publish"]},
  ],
  constraints:[{id:"gate-owner",kind:"approval",quote,start:at,end:at+quote.length,
    taskIds:["task-publish"],approverId:"person:editor"}],
};
const actor:OpsActor={kind:"person",id:"person:owner"};
let n=0;
const event=(state:ReturnType<typeof emptyOps>,e:OpsEvent)=>
  applyOps(state,{id:"replan-test-"+(++n),at:"2026-11-10T12:00:00Z",actor,event:e});
const baseline=()=>event(emptyOps(),{type:"mission.create",plan});
const payload=()=>({
  addedTasks:[{id:"task-review",title:"Concept controleren",taskKind:"text-metrics",
    dependsOn:["task-draft"],textFrom:"task-draft"}],
  addedPhases:[{id:"phase-review",title:"Nacontrole",taskIds:["task-review"]}],
  addedConstraints:[],
  missingInformation:["Is de inhoudelijke controle voldoende?"],
});
const model=(reply:unknown):PlanningModel=>({
  id:"mock:revision",
  async propose(){throw new Error("first-plan method should not be called")},
  async proposeRevision(context:ReplanContext){
    assert.equal(context.originalInstruction,instruction);
    assert.equal(context.currentRevision,1);
    assert.deepEqual(context.existingTasks.map(t=>t.id),["task-draft","task-publish"]);
    assert.equal(JSON.stringify(context).includes("  Concept  "),false);
    assert.equal(context.existingPhases?.length,2);
    return reply;
  },
});
test("replanning adds tasks without rewriting source, old work or permissions",async()=>{
  let state=baseline();
  const before=structuredClone(state);
  const candidate=await proposeMissionRevision(state.missions[plan.id],model(payload()),"Extra controle");
  assert.equal(candidate.status,"requires-human-review");
  assert.equal(candidate.constraintCoverage,"not-evaluated");
  assert.equal(candidate.expectedRevision,1);
  assert.equal(candidate.missionId,plan.id);
  assert.deepEqual(candidate.missingInformation,["Is de inhoudelijke controle voldoende?"]);
  assert.deepEqual(candidate.plan.tasks.slice(0,2),plan.tasks);
  assert.equal(candidate.plan.sourceInstruction,instruction);
  assert.equal(candidate.plan.constraints?.[0].approverId,"person:editor");
  assert.deepEqual(candidate.plan.constraints?.[0].taskIds,["task-publish","task-review"]);
  assert.equal(candidate.plan.phases?.length,3);
  assert.deepEqual(state,before,"a model suggestion must not persist state");
  state=event(state,{type:"mission.extend",missionId:plan.id,
    expectedRevision:candidate.expectedRevision,plan:candidate.plan});
  assert.equal(state.missions[plan.id].revision,2);
  assert.equal(state.missions[plan.id].tasks["task-review"].status,"queued");
});
test("model cannot repeat old task IDs, move old phase tasks or target old tasks with extra guards",async()=>{
  const mission=baseline().missions[plan.id];
  await assert.rejects(proposeMissionRevision(mission,model({
    ...payload(),addedTasks:[{...payload().addedTasks[0],id:"task-draft"}],
  }),"Extra controle"),/duplicate task/);
  await assert.rejects(proposeMissionRevision(mission,model({
    ...payload(),addedPhases:[{id:"phase-review",title:"Verkeerde indeling",
      taskIds:["task-draft","task-review"]}],
  }),"Extra controle"),/duplicate phase task/);
  await assert.rejects(proposeMissionRevision(mission,model({
    ...payload(),addedConstraints:[{id:"new-condition",kind:"condition",
      quote,start:at,end:at+quote.length,taskIds:["task-draft"]}],
  }),"Extra controle"),/only target new tasks/);
});
test("missing phases, invented text, duplicate questions and unknown fields are rejected",async()=>{
  const mission=baseline().missions[plan.id];
  await assert.rejects(proposeMissionRevision(mission,model({
    ...payload(),addedPhases:[],
  }),"Extra controle"),/requires new phases/);
  await assert.rejects(proposeMissionRevision(mission,model({
    ...payload(),addedTasks:[],extraPower:true,
  }),"Extra controle"),/unsupported revision proposal fields/);
  await assert.rejects(proposeMissionRevision(mission,model({
    ...payload(),missingInformation:["Check?", "Check?"],
  }),"Extra controle"),/invalid revision proposal details/);
  await assert.rejects(proposeMissionRevision(mission,model({
    ...payload(),addedConstraints:[{id:"new-condition",kind:"condition",
      quote:"niet in bron",start:0,end:12,taskIds:["task-review"]}],
  }),"Extra controle"),/not anchored/);
});
test("missing revision adapter, active execution and unreasonable reasons block proposals",async()=>{
  const mission=baseline().missions[plan.id];
  const unavailable:PlanningModel={id:"model:no-replan",async propose(){return null}};
  await assert.rejects(proposeMissionRevision(mission,unavailable,"Fix"),/not configured/);
  await assert.rejects(proposeMissionRevision(mission,model(payload())," "),/invalid revision reason/);
  const busy={...mission,tasks:{...mission.tasks,"task-draft":{
    ...mission.tasks["task-draft"],status:"running" as const,
  }}};
  await assert.rejects(proposeMissionRevision(busy,model(payload()),"Fix"),/stop running work/);
});

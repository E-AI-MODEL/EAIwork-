import {test} from "node:test";
import assert from "node:assert/strict";
import {inspectMissionPlan} from "../packages/operations/src/preflight.ts";
import {applyOps,emptyOps,type OpsActor,type OpsEvent} from "../packages/operations/src/registry.ts";
import {validateMissionPlan,blockingConstraints,type MissionPlan} from "../packages/operations/src/missions.ts";

const instruction="Zoek bronnen. Verstuur pas na toestemming. Controleer of de bron compleet is.";
const approval="toestemming";
const uncertainty="of de bron compleet is";
const quote=(q:string)=>({quote:q,start:instruction.indexOf(q),end:instruction.indexOf(q)+q.length});
const plan:MissionPlan={
  id:"mission-phase-preflight",title:"Voorbeeldonderzoek",goal:"Onderzoek eerst en verstuur pas na goedkeuring",
  sourceInstruction:instruction,
  tasks:[
    {id:"task-search",title:"Bronnen zoeken",taskKind:"text-normalize",dependsOn:[],input:{text:"  bron  "}},
    {id:"task-check",title:"Bronnen controleren",taskKind:"text-metrics",dependsOn:["task-search"],textFrom:"task-search"},
    {id:"task-send",title:"Versturen",taskKind:"publish",effect:"publish",dependsOn:["task-check"],input:{text:"bron"}},
  ],
  phases:[
    {id:"phase-research",title:"Onderzoeken",taskIds:["task-search","task-check"]},
    {id:"phase-deliver",title:"Opleveren",taskIds:["task-send"]},
  ],
  constraints:[
    {id:"gate-approval",kind:"approval",...quote(approval),taskIds:["task-send"],approverId:"person:owner"},
    {id:"gate-uncertainty",kind:"uncertainty",...quote(uncertainty),taskIds:["task-check"]},
  ],
};
test("preflight gives structural phases, dependency waves and blockers without approving execution",()=>{
  const result=inspectMissionPlan(plan,{missingInformation:["Welke bron is leidend?"]});
  assert.equal(result.status,"requires-human-review");
  assert.equal(result.structuralValidation,"passed");
  assert.equal(result.instructionCoverage,"not-evaluated");
  assert.equal(result.approvalGranted,false);
  assert.equal(result.canExecute,false);
  assert.deepEqual(result.dependencyWaves,[["task-search"],["task-check"],["task-send"]]);
  assert.deepEqual(result.phases,plan.phases);
  assert.equal(result.tasks[0].phaseId,"phase-research");
  assert.equal(result.tasks[1].dependencyLevel,1);
  assert.ok(result.tasks[1].blockers.includes("uncertainty-not-resolved"));
  assert.ok(result.tasks[2].blockers.includes("human-approval-required"));
  assert.ok(result.tasks[2].blockers.includes("external-effect-not-authorized"));
  assert.ok(result.tasks.every(x=>x.workerAssessment==="not-checked"));
  assert.deepEqual(result.missingInformation,["Welke bron is leidend?"]);
});
test("automatic dependency waves can be shown for older plans without phase data",()=>{
  const legacy:MissionPlan={...plan,phases:undefined};
  const result=inspectMissionPlan(legacy);
  assert.deepEqual(result.phases.map(p=>p.taskIds),result.dependencyWaves);
  assert.equal(result.phases.length,3);
});
test("invalid phase coverage, overlap, later dependencies and cycles are rejected",()=>{
  assert.throws(()=>validateMissionPlan({...plan,phases:[]}),/mission phases/);
  assert.throws(()=>validateMissionPlan({...plan,phases:[
    {id:"phase-one",title:"One",taskIds:["task-search","task-check"]},
  ]}),/every task must belong/);
  assert.throws(()=>validateMissionPlan({...plan,phases:[
    {id:"phase-one",title:"One",taskIds:["task-search","task-check"]},
    {id:"phase-two",title:"Two",taskIds:["task-check","task-send"]},
  ]}),/duplicate phase task/);
  assert.throws(()=>validateMissionPlan({...plan,phases:[
    {id:"phase-one",title:"One",taskIds:["task-send"]},
    {id:"phase-two",title:"Two",taskIds:["task-search","task-check"]},
  ]}),/later phase/);
  assert.throws(()=>validateMissionPlan({...plan,tasks:[
    {...plan.tasks[0],dependsOn:["task-send"]},...plan.tasks.slice(1),
  ]}),/cyclic dependency/);
});
const owner:OpsActor={kind:"person",id:"person:owner"};
const runner:OpsActor={kind:"system",id:"system:mission-runner"};
let n=0;
const append=(state:ReturnType<typeof emptyOps>,event:OpsEvent,actor:OpsActor=owner)=>
  applyOps(state,{id:"preflight-"+(++n),at:"2026-11-10T12:00:00Z",actor,event});
test("uncertainty gates block actual starts until human evidence is recorded",()=>{
  let state=append(emptyOps(),{type:"mission.create",plan});
  let m=state.missions[plan.id];
  assert.deepEqual(blockingConstraints(m,"task-check").map(x=>x.id),["gate-uncertainty"]);
  const started={type:"task.started" as const,missionId:plan.id,taskId:"task-check",run:{
    runId:"run-test",workerId:"text-metrics",workerVersion:"1.0.0",adapterId:"text-metrics",
    inputHash:"a".repeat(64),startedAt:"2026-11-10T12:00:00Z",verification:"not-evaluated" as const,
  }};
  assert.throws(()=>append(state,started,runner),/dependencies|blocked/);
  state=append(state,{type:"mission.gate.resolve",missionId:plan.id,
    constraintId:"gate-uncertainty",evidenceRef:"review:source-completeness-checked"});
  m=state.missions[plan.id];
  assert.deepEqual(blockingConstraints(m,"task-check"),[]);
});
test("approved phase extensions cannot reassign already planned tasks",()=>{
  let state=append(emptyOps(),{type:"mission.create",plan});
  const nextTask={id:"task-archive",title:"Bewaren",taskKind:"text-metrics",
    dependsOn:["task-send"],input:{text:"ok"}};
  const constraints=plan.constraints!.map(c=>({...c,taskIds:[...c.taskIds,"task-archive"]}));
  const proposed:MissionPlan={...plan,tasks:[...plan.tasks,nextTask],constraints,
    phases:[...plan.phases!,{id:"phase-archive",title:"Archiveren",taskIds:["task-archive"]}]};
  state=append(state,{type:"mission.extend",missionId:plan.id,expectedRevision:1,plan:proposed});
  assert.equal(state.missions[plan.id].revision,2);
  const reshuffle:MissionPlan={...proposed,tasks:[...proposed.tasks,
    {id:"task-extra",title:"Extra",taskKind:"text-metrics",dependsOn:[],input:{text:"extra"}}],
    constraints:constraints.map(c=>({...c,taskIds:[...c.taskIds,"task-extra"]})),
    phases:[
      {...proposed.phases![0],taskIds:["task-search"]},
      {...proposed.phases![1],taskIds:["task-check","task-send"]},
      proposed.phases![2],
      {id:"phase-extra",title:"Extra",taskIds:["task-extra"]},
    ],
  };
  assert.throws(()=>append(state,{type:"mission.extend",missionId:plan.id,
    expectedRevision:2,plan:reshuffle}),/phases must append/);
});

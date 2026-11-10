import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, emptyOps, type OpsEvent, type OpsEnvelope } from "../packages/operations/src/registry.ts";
import { blockingConstraints, missionProgress, validateMissionPlan, type MissionPlan } from "../packages/operations/src/missions.ts";

const text="Maak een conceptmail. Verstuur pas na schriftelijk akkoord van de rector.";
const approval="schriftelijk akkoord van de rector";
const at=text.indexOf(approval);
const plan:MissionPlan={
  id:"mission-approval",title:"Concept en verzending",goal:"Behoud toestemming tijdens opdelen",
  sourceInstruction:text,
  constraints:[{id:"gate-rector",kind:"approval",quote:approval,start:at,
    end:at+approval.length,taskIds:["task-send"],approverId:"person:rector"}],
  tasks:[
    {id:"task-draft",title:"Concept schrijven",taskKind:"text-normalize",dependsOn:[],input:{text}},
    {id:"task-send",title:"Verzending",taskKind:"external-send",dependsOn:["task-draft"],
      input:{text:"versturen"},effect:"external-write"},
  ]
};
const person={kind:"person" as const,id:"person:operator"};
const rector={kind:"person" as const,id:"person:rector"};
const model={kind:"system" as const,id:"system:planner"};
const runner={kind:"system" as const,id:"system:mission-runner"};
let n=0;
function commit(state:ReturnType<typeof emptyOps>,event:OpsEvent,actor:typeof person|typeof model|typeof runner|typeof rector=person){
 return applyOps(state,{id:"guard-event-"+(++n),at:"2026-11-10T00:00:00Z",actor,event} as OpsEnvelope);
}
test("approved task plan preserves exact source spans and blocks unapproved effects",()=>{
  assert.doesNotThrow(()=>validateMissionPlan(plan));
  assert.throws(()=>validateMissionPlan({...plan,sourceInstruction:text.replace("schriftelijk","telefonisch")}),/not anchored/);
  assert.throws(()=>validateMissionPlan({...plan, constraints:[]}),/require an explicit/);
  assert.throws(()=>validateMissionPlan({...plan,constraints:[{...plan.constraints![0],taskIds:["task-unknown"]}]}),/targets/);
  assert.throws(()=>validateMissionPlan({...plan,constraints:[{...plan.constraints![0],approverId:""}]}),/approver/);
  let state=commit(emptyOps(),{type:"mission.create",plan});
  const m=state.missions[plan.id];
  assert.equal(missionProgress(m).blockedByConstraints,1);
  assert.deepEqual(blockingConstraints(m,"task-send").map(g=>g.id),["gate-rector"]);
  assert.throws(()=>commit(state,{type:"task.started",missionId:plan.id,taskId:"task-send",
    run:{runId:"run-aa1",workerId:"fake-worker",workerVersion:"1",adapterId:"fake",
      inputHash:"a".repeat(64),startedAt:"2026-11-10T00:00:00Z",verification:"not-evaluated"}},runner),/dependencies|blocked/);
  assert.throws(()=>commit(state,{type:"mission.gate.resolve",missionId:plan.id,
    constraintId:"gate-rector",evidenceRef:"approval:1"},person),/designated person/);
  assert.throws(()=>commit(state,{type:"mission.gate.resolve",missionId:plan.id,
    constraintId:"gate-rector",evidenceRef:"approval:1"},model),/designated person/);
  state=commit(state,{type:"mission.gate.resolve",missionId:plan.id,
    constraintId:"gate-rector",evidenceRef:"approval:1"},rector);
  assert.equal(blockingConstraints(state.missions[plan.id],"task-send").length,0);
  assert.equal(state.missions[plan.id].resolvedGates["gate-rector"].by,"person:rector");
  assert.throws(()=>commit(state,{type:"mission.gate.resolve",missionId:plan.id,
    constraintId:"gate-rector",evidenceRef:"approval:2"},rector),/already resolved/);
});
test("an unconditional prohibition cannot be bypassed by an approval",()=>{
  const quote="Verstuur niet.";
  const blocked:MissionPlan={...plan,id:"mission-prohibited",
    sourceInstruction:"Maak een concept. "+quote,
    constraints:[
      {id:"gate-prohibition",kind:"prohibition",quote,start:17,end:17+quote.length,taskIds:["task-send"]},
      {id:"gate-override",kind:"approval",quote:"Maak een concept",start:0,end:16,
        taskIds:["task-send"],approverId:"person:rector"},
    ]};
  // Source-anchored approvals are not inferred. The quoted proposal must be exact.
  blocked.constraints![0].start=blocked.sourceInstruction!.indexOf(quote);
  blocked.constraints![0].end=blocked.constraints![0].start+quote.length;
  blocked.constraints![1].end=blocked.constraints![1].quote.length;
  const s=commit(emptyOps(),{type:"mission.create",plan:blocked});
  const approved=commit(s,{type:"mission.gate.resolve",missionId:blocked.id,
    constraintId:"gate-override",evidenceRef:"approval:other"},rector);
  assert.deepEqual(blockingConstraints(approved.missions[blocked.id],"task-send").map(x=>x.id),["gate-prohibition"]);
});

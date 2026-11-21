import {test} from "node:test";
import assert from "node:assert/strict";
import {applyOps,emptyOps} from "../packages/operations/src/registry.ts";
import {cloudTransition,cloudView} from "../packages/cloud/src/controller.ts";
import {runMissionStep} from "../packages/operations/src/execution.ts";
import {chooseExecutionSite,CLOUD_PILOT_SITES} from "../packages/operations/src/execution-site.ts";

const owner="person:cloud-owner";
const commit=async(state:any,input:unknown)=>{
  const result=await cloudTransition(state,input,owner);
  assert.deepEqual(result.events.reduce((s,event)=>applyOps(s,event),state),result.next);
  return result;
};
test("existing queued mission can switch between local and cloud with audited owner-only revision",async()=>{
  const instruction="Bouw een dashboard met filters";
  const first=await commit(emptyOps(),{type:"submit",instruction,executionPreference:"cloud"});
  const id=first.result.missionId as string;
  const second=await commit(first.next,{type:"route",missionId:id,
    expectedRevision:1,executionPreference:"local"});
  assert.deepEqual(second.events.map(x=>x.event.type),["mission.execution.select"]);
  assert.equal(second.next.missions[id].plan.sourceInstruction,instruction);
  assert.equal(second.next.missions[id].plan.executionPreference,"local");
  assert.equal(second.next.missions[id].revision,2);
  assert.equal(second.next.missions[id].tasks["task-inspect"].status,"queued");
  assert.equal(cloudView(second.next).missions[0].execution.site,null);
  await assert.rejects(commit(second.next,{type:"route",missionId:id,
    expectedRevision:1,executionPreference:"cloud"}),/stale/);
  await assert.rejects(cloudTransition(second.next,{type:"route",missionId:id,
    expectedRevision:2,executionPreference:"cloud"},"person:other-owner"),/eigenaar/);
  await assert.rejects(commit(second.next,{type:"route",missionId:id,
    expectedRevision:2,executionPreference:"local"}),/already selected/);
});
test("completed missions cannot be re-routed or re-run",async()=>{
  let state=emptyOps();
  const initial=await commit(state,{type:"create",title:"Workerfixture",text:"een"});
  state=initial.next;
  state=(await commit(state,{type:"prepare",missionId:initial.result.missionId as string})).next;
  state=(await commit(state,{type:"release",missionId:initial.result.missionId as string})).next;
  const finished=await commit(state,{type:"submit",instruction:"Tel de woorden in deze tekst",
    sourceText:"Voorbeeld",executionPreference:"cloud"});
  const id=finished.result.missionId as string;
  assert.equal(finished.next.missions[id].tasks["task-inspect"].status,"done");
  await assert.rejects(commit(finished.next,{type:"route",missionId:id,
    expectedRevision:1,executionPreference:"local"}),/only before any task starts/);
  assert.equal(cloudView(finished.next).missions[0].output?.words,1);
});
test("native Node local runner and scheduler reject cloud-designated missions",async()=>{
  const first=await commit(emptyOps(),{type:"submit",instruction:"Bouw een dashboard",
    executionPreference:"cloud"});
  const id=first.result.missionId as string;
  assert.throws(()=>runMissionStep({snapshot:()=>first.next} as any,id),/cloud-designated/);
  const event={id:"event-denied",at:"2026-11-21T09:00:00.000Z",
    actor:{kind:"person" as const,id:owner},
    event:{type:"mission.automation.start" as const,missionId:id,maxStarts:1}};
  assert.throws(()=>applyOps(first.next,event),/cloud-designated/);
});
test("an extension cannot silently switch the selected execution environment",async()=>{
  const first=await commit(emptyOps(),{type:"submit",
    instruction:"Bouw een dashboard",executionPreference:"local"});
  const id=first.result.missionId as string;
  const current=first.next.missions[id].plan;
  const extension={...current,executionPreference:"cloud" as const,
    tasks:[...current.tasks,{id:"task-followup",title:"Vervolg",taskKind:"request-review",
      dependsOn:[],effect:"local" as const,input:{text:"voorstel"}}]};
  const event={id:"event-no-stealth",at:"2026-11-21T09:00:00.000Z",
    actor:{kind:"person" as const,id:owner},
    event:{type:"mission.extend" as const,missionId:id,expectedRevision:1,plan:extension}};
  assert.throws(()=>applyOps(first.next,event),/execution preference/);
  assert.equal(first.next.missions[id].revision,1);
});
test("trusted inventory chooses actual available execution site, never client assertion",()=>{
  assert.equal(chooseExecutionSite("text-inspect","auto",CLOUD_PILOT_SITES).site,"cloud");
  assert.equal(chooseExecutionSite("text-inspect","local",CLOUD_PILOT_SITES).site,null);
  assert.equal(chooseExecutionSite("request-review","cloud",CLOUD_PILOT_SITES).site,null);
  const inventory=[{id:"local" as const,connected:true,taskKinds:["text-inspect"]},
    {id:"cloud" as const,connected:true,taskKinds:["text-inspect"]}];
  assert.equal(chooseExecutionSite("text-inspect","auto",inventory).site,"local");
  assert.equal(chooseExecutionSite("text-inspect","cloud",inventory).site,"cloud");
});

import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {OpsStore} from "../packages/operations/src/store.ts";
import {evaluateBuiltin} from "../packages/operations/src/execution.ts";
import {runAgentCycle,observeAgentMission} from "../packages/operations/src/agent-loop.ts";
import type {OpsEvent,OpsActor,WorkerContract} from "../packages/operations/src/registry.ts";
import type {PlanningModel} from "../packages/operations/src/planner.ts";

const human:OpsActor={kind:"person",id:"person:owner"};
const checker:OpsActor={kind:"check",id:"check:builtins"};
const contract=(id:"text-normalize"|"text-metrics"):WorkerContract=>({
  id,version:"1.0.0",name:id,specialization:"Fixed local text worker",
  taskKinds:[id],inputSchema:{type:"object"},outputSchema:{type:"object"},
  tools:[],requestedPermissions:[],modelPolicy:{preferred:"deterministic"},
  testSuite:"builtin-fixture-v1",stopConditions:["bad-input"],
});
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),"eai-agent-loop-"));
  const store=new OpsStore(dir);
  const append=(event:OpsEvent,actor:OpsActor=human)=>store.append({
    id:"agent-test-"+randomUUID(),at:new Date().toISOString(),actor,event,
  });
  const admit=(id:"text-normalize"|"text-metrics")=>{
    const c=contract(id);
    append({type:"worker.register",contract:c});
    const testResult=evaluateBuiltin(id,c);
    assert.equal(testResult.numerator,testResult.denominator);
    const evidenceRef="fixture:"+randomUUID();
    append({type:"quality.record",measurement:{
      id:"measure-"+randomUUID(),workerId:id,version:c.version,
      taskKind:testResult.taskKind,dataset:testResult.dataset,
      suiteVersion:testResult.suiteVersion,cohort:testResult.cohort,
      metric:testResult.metric,numerator:testResult.numerator,
      denominator:testResult.denominator,measuredAt:new Date().toISOString(),evidenceRef,
    }},checker);
    append({type:"worker.release",id,evidenceRef});
  };
  const plan=(id:string)=>({id,title:"Agent proef",
    goal:"Twee gecontroleerde lokale taken achter elkaar uitvoeren",
    tasks:[
      {id:"task-clean",title:"Opschonen",taskKind:"text-normalize",
        dependsOn:[],input:{text:"  Hallo   wereld "}},
      {id:"task-count",title:"Tellen",taskKind:"text-metrics",
        dependsOn:["task-clean"],textFrom:"task-clean"},
    ],
  });
  return {store,append,admit,plan,close:()=>{store.close();rmSync(dir,{recursive:true,force:true})}};
}

test("agent makes separate observe/act/check decisions and completes a two-task mission",async()=>{
  const f=fixture();
  try{
    f.admit("text-normalize");f.admit("text-metrics");
    f.append({type:"mission.create",plan:f.plan("mission-agent-success")});
    const result=await runAgentCycle(f.store,"mission-agent-success",{
      requestedBy:human.id,maxStarts:2,
    });
    assert.equal(result.stopReason,"complete");
    assert.equal(result.starts,2);
    assert.deepEqual(result.batches.flatMap(b=>b.completed),["task-clean","task-count"]);
    assert.equal(result.decisions.length,2);
    const m=f.store.snapshot().missions["mission-agent-success"];
    assert.equal(m.tasks["task-count"].run?.output?.words,2);
    assert.equal(m.tasks["task-count"].run?.verification,"not-evaluated");
    assert.equal(m.revision,1);
    assert.equal(f.store.verify().ok,true);
  }finally{f.close()}
});

test("the request's action budget cannot expand itself",async()=>{
  const f=fixture();
  try{
    f.admit("text-normalize");f.admit("text-metrics");
    f.append({type:"mission.create",plan:f.plan("mission-agent-budget")});
    const first=await runAgentCycle(f.store,"mission-agent-budget",{
      requestedBy:human.id,maxStarts:1,
    });
    assert.equal(first.stopReason,"budget-exhausted");
    assert.equal(first.starts,1);
    assert.equal(f.store.snapshot().missions["mission-agent-budget"].tasks["task-count"].status,"queued");
    const next=await runAgentCycle(f.store,"mission-agent-budget",{requestedBy:human.id});
    assert.equal(next.stopReason,"complete");
    assert.equal(next.starts,1);
    await assert.rejects(runAgentCycle(f.store,"mission-agent-budget",{requestedBy:human.id,maxStarts:9}),/1-8/);
  }finally{f.close()}
});

test("an unknown worker blocks without fake execution or automatic retry",async()=>{
  const f=fixture();
  try{
    f.append({type:"mission.create",plan:f.plan("mission-agent-no-worker")});
    const res=await runAgentCycle(f.store,"mission-agent-no-worker",{requestedBy:human.id,maxStarts:4});
    assert.equal(res.stopReason,"blocked");
    assert.equal(res.starts,0);
    assert.equal(f.store.snapshot().missions["mission-agent-no-worker"].tasks["task-clean"].status,"queued");
    assert.equal(f.store.verify().ok,true);
  }finally{f.close()}
});

test("other people and an active scheduler cannot enter the agent loop",async()=>{
  const f=fixture();
  try{
    f.admit("text-normalize");f.admit("text-metrics");
    f.append({type:"mission.create",plan:f.plan("mission-agent-auth")});
    await assert.rejects(runAgentCycle(f.store,"mission-agent-auth",{
      requestedBy:"person:other",maxStarts:1,
    }),/original mission approver/);
    f.append({type:"mission.automation.start",missionId:"mission-agent-auth",maxStarts:1});
    const r=await runAgentCycle(f.store,"mission-agent-auth",{requestedBy:human.id,maxStarts:1});
    assert.equal(r.stopReason,"in-progress");assert.equal(r.starts,0);
  }finally{f.close()}
});

test("a source permission gate is never bypassed, including for a model revision",async()=>{
  const f=fixture();
  try{
    const instruction="Publiceer pas na toestemming";
    const index=instruction.indexOf("toestemming");
    const plan={
      id:"mission-agent-gated",title:"Publicatie",goal:"Alleen na toestemming",
      sourceInstruction:instruction,
      constraints:[{id:"gate-person",kind:"approval" as const,quote:"toestemming",
        start:index,end:index+"toestemming".length,taskIds:["task-publish"],
        approverId:human.id}],
      tasks:[{id:"task-publish",title:"Publiceren",taskKind:"publish",effect:"publish" as const,
        dependsOn:[],input:{text:"concept"}}],
    };
    f.append({type:"mission.create",plan});
    let called=0;
    const planningModel:PlanningModel={id:"test:untrusted",async propose(){called++;return null},
      async proposeRevision(){called++;return null}};
    const r=await runAgentCycle(f.store,"mission-agent-gated",{
      requestedBy:human.id,maxStarts:2,proposeOnBlock:true,planningModel,
    });
    assert.equal(r.stopReason,"needs-review");
    assert.equal(r.starts,0);
    assert.equal(called,0);
    assert.equal(f.store.snapshot().missions["mission-agent-gated"].tasks["task-publish"].status,"queued");
    f.append({type:"mission.gate.resolve",missionId:"mission-agent-gated",constraintId:"gate-person",evidenceRef:"review:test"});
    assert.equal(observeAgentMission(f.store.snapshot().missions["mission-agent-gated"]).reason,"needs-review",
      "even an approved external task remains outside the agent's local execution rights");
  }finally{f.close()}
});

test("a draft revision is never applied or treated as proof",async()=>{
  const f=fixture();
  try{
    f.append({type:"mission.create",plan:f.plan("mission-agent-revision")});
    let called=0;
    const model:PlanningModel={id:"mock:planner",
      async propose(){throw Error("unexpected initial plan")},
      async proposeRevision(){
        called++;
        return {addedTasks:[{id:"task-review",title:"Review",taskKind:"text-metrics",
          dependsOn:["task-clean"],textFrom:"task-clean"}],
          addedPhases:[],addedConstraints:[],missingInformation:[]};
      },
    };
    const r=await runAgentCycle(f.store,"mission-agent-revision",{
      requestedBy:human.id,maxStarts:1,proposeOnBlock:true,planningModel:model,
    });
    assert.equal(r.stopReason,"blocked");
    assert.equal(called,1);
    assert.equal(r.revisionProposal?.status,"requires-human-review");
    assert.equal(r.revisionProposal?.expectedRevision,1);
    assert.equal(f.store.snapshot().missions["mission-agent-revision"].revision,1);
    assert.equal(f.store.snapshot().missions["mission-agent-revision"].plan.tasks.length,2);
  }finally{f.close()}
});

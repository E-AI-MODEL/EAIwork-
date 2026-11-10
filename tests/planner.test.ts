import {test} from "node:test";
import assert from "node:assert/strict";
import {localOllamaPlanningModel,proposeMissionPlan,type PlanningModel} from "../packages/operations/src/planner.ts";

const instruction="Maak een concept. Publiceer pas na schriftelijk akkoord van de rector.";
const quote="schriftelijk akkoord van de rector";
const start=instruction.indexOf(quote);
const payload=()=>{
  return {title:"Concept en publicatie",goal:"Bewaar toestemming tot de menselijke controle.",
    tasks:[
      {id:"task-draft",title:"Concept normaliseren",taskKind:"text-normalize",dependsOn:[],input:{text:"Concept"}},
      {id:"task-publish",title:"Document publiceren",taskKind:"external-publish",
        dependsOn:["task-draft"],input:{text:"Concept"},effect:"publish"},
    ],
    constraints:[{id:"gate-rector",kind:"approval",quote,start,end:start+quote.length,
      taskIds:["task-publish"],approverId:"person:rector"}],
  };
};
test("planning proposal preserves source, exact approval, and never grants permission",async()=>{
  const model:PlanningModel={id:"mock:planner",async propose(source){
    assert.equal(source,instruction);return payload();
  }};
  const output=await proposeMissionPlan(instruction,model,"mission-candidate-01");
  assert.equal(output.plan.sourceInstruction,instruction);
  assert.equal(output.status,"requires-human-review");
  assert.equal(output.constraintCoverage,"not-evaluated");
  assert.equal(output.modelId,"mock:planner");
  assert.match(output.sourceSha256,/^[a-f0-9]{64}$/);
  assert.equal(output.plan.tasks[1].effect,"publish");
  assert.equal(output.plan.constraints![0].approverId,"person:rector");
});
test("missing, mislocated, or falsely asserted constraints are rejected",async()=>{
  const model=(reply:unknown):PlanningModel=>({id:"mock",async propose(){return reply}});
  const withoutApproval={...payload(),constraints:[]};
  await assert.rejects(proposeMissionPlan(instruction,model(withoutApproval),"mission-candidate-02"),/approval gate/);
  const incorrect={...payload(),constraints:[{...payload().constraints[0],quote:"verzonnen passage"}]};
  await assert.rejects(proposeMissionPlan(instruction,model(incorrect),"mission-candidate-03"),/not anchored/);
  const extra={...payload(),secretApproval:true};
  await assert.rejects(proposeMissionPlan(instruction,model(extra),"mission-candidate-04"),/unsupported plan fields/);
  await assert.rejects(proposeMissionPlan(" ",model(payload()),"mission-candidate-05"),/invalid instruction length/);
});
test("planner provider refuses external Ollama endpoints and unbounded timeout",()=>{
  assert.throws(()=>localOllamaPlanningModel({model:"qwen2.5:7b",host:"https://example.com"}),/local loopback/);
  assert.throws(()=>localOllamaPlanningModel({model:"qwen2.5:7b",timeoutMs:500000}),/timeout/);
});

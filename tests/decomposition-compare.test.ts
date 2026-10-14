import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compareArms, compareScores, selectCases, PILOT_IDS } from "../experiments/decomposition/compare-core.ts";
import type { Task, Gold } from "../experiments/decomposition/spec.ts";

const load = (name: string) => JSON.parse(readFileSync(
  new URL("../experiments/decomposition/"+name,import.meta.url),"utf8"));
const all: Task[] = load("tasks.json"), gold: Gold[] = load("gold.dev.json");

test("pilot is exactly one visible DEV case in each domain",()=>{
  const tasks = selectCases(all,"pilot");
  assert.deepEqual(tasks.map(t=>t.id), [...PILOT_IDS]);
  assert.equal(new Set(tasks.map(t=>t.domain)).size,6);
});
test("compare executes 1+1+2+3 source-only stages and rotates arm order",async()=>{
  const tasks=selectCases(all,"pilot");
  const order:string[]=[];
  const outputs=await compareArms(tasks,async(task,stage,prompt)=>{
    order.push(task.id+":"+stage);
    assert.ok(prompt.includes(task.text));
    assert.ok(!prompt.includes("GOLD_LABEL"));
    if(stage==="probe")return {content:{spans:[],candidates:[
      {text:"Possible missing external approval",status:"hypothesis",reason:"not in task"}
    ]},input_tokens:7,output_tokens:2};
    const quote=task.text.slice(0,Math.min(10,task.text.length));
    return {content:{spans:[{kind:"action",quote}],candidates:[]},input_tokens:7,output_tokens:2};
  });
  assert.equal(order.length,tasks.length*7);
  assert.deepEqual(order.slice(0,7),["edu03:whole","edu03:atoms","edu03:shape",
    "edu03:meaning","edu03:shape","edu03:meaning","edu03:probe"]);
  assert.equal(order[7],"fin01:atoms"); // rotated order
  for(const arm of ["A","B","C","D"] as const) {
    assert.equal(outputs[arm].length,6);
    assert.ok(outputs[arm].every(p=>!p.failure));
  }
  const selectedGold=tasks.map(t=>gold.find(g=>g.id===t.id)!);
  const scores=compareScores(tasks,selectedGold,outputs) as any;
  assert.equal(scores.A.validCases,6);
  assert.equal(scores.C.total_calls,12);
  assert.equal(scores.D.total_calls,18);
  assert.equal(scores.A.input_tokens,42);
  assert.equal(scores.D.input_tokens,126);
  assert.deepEqual(outputs.C.map(p=>p.spans),outputs.D.map(p=>p.spans));
  assert.ok(outputs.D.every(p=>p.candidates.every(c=>c.status==="hypothesis")));
});
test("timeout/JSON failures remain explicit and metrics do not call them correct",async()=>{
  const t=selectCases(all,"pilot");
  const results=await compareArms(t,async(_task,stage)=>{
    if(stage==="meaning")throw new Error("timeout");
    return {content:{spans:[]}};
  });
  assert.equal(results.C.filter(x=>x.failure).length,6);
  assert.equal(results.D.filter(x=>x.failure).length,6);
  const goldSubset=t.map(x=>gold.find(g=>g.id===x.id)!);
  const scores=compareScores(t,goldSubset,results) as any;
  assert.equal(scores.C.failedCases,6);
  assert.equal(scores.C.validCases,0);
  assert.equal(scores.C.coverageOfGold,0);
});

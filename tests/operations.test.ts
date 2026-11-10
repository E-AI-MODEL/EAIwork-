import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyOps, emptyOps, qualityOverview, type OpsEnvelope, type OpsEvent, type OpsState } from "../packages/operations/src/registry.ts";
import { OpsStore } from "../packages/operations/src/store.ts";

const contract = {
  id:"scientific-reviewer",version:"1.0.0",name:"Scientific Reviewer",
  specialization:"Compare study claims with source passages",
  taskKinds:["claim-review"],inputSchema:{type:"object"},outputSchema:{type:"object"},
  tools:["source-read"],requestedPermissions:["read:sources"],
  modelPolicy:{preferred:"medium" as const},testSuite:"evidence-review-v1",
  stopConditions:["missing-evidence","review-required"],
};
const person = {kind:"person" as const,id:"reviewer"};
const system = {kind:"system" as const,id:"quality-controller"};
const wrap = (event: OpsEvent, actor=person, id="t-"+Math.random()) : OpsEnvelope =>
  ({id,at:new Date().toISOString(),actor,event});
const registered = () => applyOps(emptyOps(),wrap({type:"worker.register",contract}));
const measure = {
  id:"m-1",workerId:"scientific-reviewer",version:"1.0.0",taskKind:"claim-review",
  dataset:"frozen-2026",suiteVersion:"v1",cohort:"blind-holdout",metric:"pass-rate",
  numerator:8,denominator:10,measuredAt:"2026-11-10T01:00:00Z",evidenceRef:"test:run-1",
};
test("registry does not grant availability without a test and human release",()=>{
  let s=registered();
  assert.equal(s.workers[contract.id].stage,"candidate");
  assert.throws(()=>applyOps(s,wrap({type:"worker.release",id:contract.id,evidenceRef:"test:run-1"})),/recorded test/);
  assert.throws(()=>applyOps(s,wrap({type:"quality.record",measurement:measure})),/trusted/);
  s=applyOps(s,wrap({type:"quality.record",measurement:measure},system));
  assert.equal(qualityOverview(s,contract.id)[0].success,.8);
  s=applyOps(s,wrap({type:"worker.release",id:contract.id,evidenceRef:"test:run-1"}));
  assert.equal(s.workers[contract.id].stage,"ready");
  assert.throws(()=>applyOps(s,wrap({type:"worker.register",contract})),/already registered/);
  assert.throws(()=>applyOps(s,wrap({type:"quality.record",measurement:{...measure,id:"m-2",denominator:0}},system)),/invalid measurement/);
});
test("three separately tested failures block repair and require a person",()=>{
  let s=registered();
  s=applyOps(s,wrap({type:"defect.open",id:"d-1",workerId:contract.id,reason:"wrong citations",severity:"quality"},system));
  for(let i=1;i<=3;i++){
    s=applyOps(s,wrap({type:"repair.record",defectId:"d-1",attempt:{
      candidateVersion:"1.0."+i,diagnosis:"citation mismatch",changeRef:"change-"+i,
      suiteVersion:"v1",resultRef:"test-"+i,passed:false,at:"2026-11-10T01:00:00Z"
    }},system));
  }
  assert.equal(s.defects["d-1"].attempts.length,3);
  assert.equal(s.defects["d-1"].state,"human-required");
  assert.equal(s.workers[contract.id].stage,"quarantined");
  assert.throws(()=>applyOps(s,wrap({type:"repair.record",defectId:"d-1",attempt:{
    candidateVersion:"1.0.4",diagnosis:"retry",changeRef:"change-4",suiteVersion:"v1",resultRef:"test-4",passed:false,at:"x"
  }},system)),/not eligible/);
  assert.throws(()=>applyOps(s,wrap({type:"human.decide",defectId:"d-1",choice:"disable",rationale:"stop"},system)),/human/);
  s=applyOps(s,wrap({type:"human.decide",defectId:"d-1",choice:"disable",rationale:"Three failed independent checks"}));
  assert.equal(s.workers[contract.id].stage,"disabled");
  assert.equal(s.defects["d-1"].decision?.by,"reviewer");
});
test("security defect quarantines immediately",()=>{
  const s=applyOps(registered(),wrap({type:"defect.open",id:"security-1",workerId:contract.id,reason:"unexpected egress",severity:"security"},system));
  assert.equal(s.defects["security-1"].state,"human-required");
  assert.equal(s.workers[contract.id].stage,"quarantined");
});
test("operations journal survives restart and rejects corruption",()=>{
  const dir=mkdtempSync(join(tmpdir(),"eai-worker-ops-"));
  try{
    let store=new OpsStore(dir);
    store.append(wrap({type:"worker.register",contract},person,"event-1"));
    store.append(wrap({type:"quality.record",measurement:measure},system,"event-2"));
    assert.equal(store.verify().ok,true);
    assert.equal(store.snapshot().measurements.length,1);
    store.close();
    store=new OpsStore(dir);
    assert.equal(store.snapshot().workers[contract.id].stage,"candidate");
    store.close();
    const file=join(dir,"worker-events.jsonl");
    writeFileSync(file,readFileSync(file,"utf8").replace("Scientific Reviewer","Changed Reviewer"));
    assert.throws(()=>new OpsStore(dir),/integrity check/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

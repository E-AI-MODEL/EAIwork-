import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, emptyOps, type OpsEvent, type OpsEnvelope } from "../packages/operations/src/registry.ts";
import { driftSignals } from "../packages/operations/src/quality.ts";
const actor={kind:"system" as const,id:"validated-test-runner"};
let seq=0;
const record=(s:ReturnType<typeof emptyOps>,event:OpsEvent)=>applyOps(s,{
  id:"q-"+(++seq),at:"2026-11-10T03:00:00Z",actor:event.type==="worker.register"?{kind:"person" as const,id:"owner"}:actor,event
} as OpsEnvelope);
test("drift compares the same version, suite and data cohort",()=>{
  let s=emptyOps();
  s=record(s,{type:"worker.register",contract:{id:"review-worker",version:"1.0.0",name:"Review worker",specialization:"Review claims",taskKinds:["review"],inputSchema:{},outputSchema:{},tools:[],requestedPermissions:[],modelPolicy:{preferred:"medium"},testSuite:"suite-1",stopConditions:["no-evidence"]}});
  const metric=(id:string,numerator:number,cohort:string,at:string)=>({
    id,workerId:"review-worker",version:"1.0.0",taskKind:"review",dataset:"frozen",
    suiteVersion:"suite-1",cohort,metric:"pass-rate",numerator,denominator:100,
    measuredAt:at,evidenceRef:"test:"+id
  });
  assert.equal(driftSignals(s,"review-worker")[0].status,"not-measured");
  s=record(s,{type:"quality.record",measurement:metric("A",94,"matched","2026-10-01")});
  assert.equal(driftSignals(s,"review-worker")[0].status,"not-comparable");
  s=record(s,{type:"quality.record",measurement:metric("B",74,"matched","2026-11-10")});
  s=record(s,{type:"quality.record",measurement:metric("C",100,"new-cohort","2026-11-10")});
  const signals=driftSignals(s,"review-worker");
  assert.equal(signals.find(x=>x.baselineRef==="test:A")?.status,"declined");
  assert.equal(signals.find(x=>x.status==="not-comparable")?.status,"not-comparable");
});
test("small samples do not yield fake drift conclusions",()=>{
  const s=emptyOps();
  s.measurements.push({id:"a",workerId:"w",version:"1",taskKind:"t",dataset:"d",suiteVersion:"s",cohort:"c",metric:"accuracy",numerator:2,denominator:2,measuredAt:"2026-01-01",evidenceRef:"one"});
  s.measurements.push({id:"b",workerId:"w",version:"1",taskKind:"t",dataset:"d",suiteVersion:"s",cohort:"c",metric:"accuracy",numerator:0,denominator:2,measuredAt:"2026-02-01",evidenceRef:"two"});
  assert.equal(driftSignals(s,"w")[0].status,"insufficient-samples");
});

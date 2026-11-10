import { test } from "node:test";
import assert from "node:assert/strict";
import { WORKER_BLUEPRINTS, workerCatalog, draftContractFromBlueprint } from "../packages/operations/src/catalog.ts";
import { selectWorker, catalogOverview } from "../packages/operations/src/selector.ts";
import { applyOps, emptyOps, type OpsEnvelope, type OpsEvent } from "../packages/operations/src/registry.ts";
const human = { kind:"person" as const, id:"operator" };
const check = { kind:"check" as const, id:"test-runner" };
let num=0;
const apply = (s:ReturnType<typeof emptyOps>,e:OpsEvent,actor:typeof human|typeof check=human) =>
  applyOps(s,{id:"catalog-test-"+(++num),at:"2026-11-10T02:00:00Z",actor,event:e} as OpsEnvelope);
const runtime = () => ({
  adapterIds:["websearch"],capabilities:["web.search"],grantedPermissions:["read:public"],
  supportedModelSizes:["medium" as const],
});
const registered = () => {
  let state=emptyOps();
  const contract={...draftContractFromBlueprint("websearch"),requestedPermissions:["read:public"],testSuite:"websearch-v1"};
  state=apply(state,{type:"worker.register",contract});
  return state;
};
const ready=()=>{
  let s=registered();
  const m={id:"q1",workerId:"websearch",version:"0.1.0",taskKind:"web-search",
    dataset:"frozen-web",suiteVersion:"v1",cohort:"holdout",metric:"pass-rate",
    numerator:42,denominator:50,measuredAt:"2026-11-10T02:00:00Z",evidenceRef:"test:websearch"};
  s=apply(s,{type:"quality.record",measurement:m},check);
  s=apply(s,{type:"worker.release",id:"websearch",evidenceRef:"test:websearch"});
  return s;
};
test("catalog has specialized design entries without fake runtime state",()=>{
  const catalog=workerCatalog();
  assert.ok(catalog.length>=50);
  assert.equal(new Set(catalog.map(x=>x.id)).size,catalog.length);
  for(const group of ["plannen","zoeken","analyseren","uitvoeren","controleren","samenvoegen"])
    assert.ok(catalog.some(x=>x.group===group),"missing group "+group);
  assert.ok(catalog.some(x=>x.id==="repo-search"&&x.requiredCapabilities.includes("repo.search")));
  assert.equal(catalog.find(x=>x.id==="worker-assembler")?.suggestedModel,"medium");
  assert.ok(catalog.every(x=>x.lifecycle==="design-only"));
  const original=WORKER_BLUEPRINTS[0].name;
  catalog[0].name="changed";
  assert.equal(WORKER_BLUEPRINTS[0].name,original);
  const overview=catalogOverview(emptyOps());
  assert.equal(overview.counts.ready,0);
  assert.equal(overview.counts.active,null);
  assert.ok(overview.workers.every(x=>x.activeInstances===null));
});
test("catalog contract drafts never carry permissions or results",()=>{
  const c=draftContractFromBlueprint("repo-search");
  assert.equal(c.modelPolicy.preferred,"medium");
  assert.deepEqual(c.requestedPermissions,[]);
  assert.ok(c.tools.includes("repo.search"));
  assert.match(c.testSuite,/unconfigured/);
  assert.throws(()=>draftContractFromBlueprint("missing"),/unknown blueprint/);
});
test("selector never activates design entries or unapproved workers",()=>{
  const task={taskKind:"web-search"};
  let s=emptyOps();
  let result=selectWorker(task,s,runtime());
  assert.equal(result.selectedWorkerId,null);
  assert.equal(result.matches[0].reason,"unregistered");
  assert.equal(result.nextStep,"register-and-test");
  s=registered();
  result=selectWorker(task,s,runtime());
  assert.equal(result.selectedWorkerId,null);
  assert.equal(result.matches[0].reason,"not-released");
  s=ready();
  result=selectWorker(task,s,runtime());
  assert.equal(result.selectedWorkerId,"websearch");
  assert.equal(result.nextStep,"assign");
  assert.equal(result.matches[0].canConsider,true);
  assert.equal(catalogOverview(s).counts.active,null);
});
test("selector refuses missing adapters, capabilities, permissions and models",()=>{
  const s=ready(),task={taskKind:"web-search"};
  assert.equal(selectWorker(task,s,{...runtime(),adapterIds:[]}).selectedWorkerId,null);
  assert.equal(selectWorker(task,s,{...runtime(),capabilities:[]}).matches[0].reason,"missing-capabilities");
  assert.equal(selectWorker(task,s,{...runtime(),grantedPermissions:[]}).matches[0].reason,"permission-denied");
  assert.equal(selectWorker(task,s,{...runtime(),supportedModelSizes:["small"]}).matches[0].reason,"model-unavailable");
  assert.equal(selectWorker({...task,allowedModelSizes:["large"]},s,runtime()).selectedWorkerId,null);
  assert.equal(selectWorker({taskKind:"unknown-specialization"},s,runtime()).nextStep,"search-and-build");
});
test("open defect and quarantine prevent selection",()=>{
  let s=ready();
  s=apply(s,{type:"defect.open",id:"defect-1",workerId:"websearch",reason:"wrong source",severity:"quality"});
  assert.equal(selectWorker({taskKind:"web-search"},s,runtime()).selectedWorkerId,null);
  s=apply(s,{type:"worker.quarantine",id:"websearch",reason:"defect under review"},check);
  assert.equal(selectWorker({taskKind:"web-search"},s,runtime()).matches[0].reason,"not-released");
});

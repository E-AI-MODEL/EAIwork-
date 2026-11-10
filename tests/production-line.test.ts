import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "../scripts/local-demo.ts";
import {applyOps,emptyOps,type OpsActor} from "../packages/operations/src/registry.ts";
import {productionLineView} from "../packages/operations/src/production-line.ts";
import type {RuntimeInventory} from "../packages/operations/src/selector.ts";

const person:OpsActor={kind:"person",id:"person:tester"};
const runtime:RuntimeInventory={adapterIds:[],capabilities:[],
  grantedPermissions:[],supportedModelSizes:["deterministic"]};
let id=0;
const stateWithMission=()=>{
  const plan={
    id:"mission-production-unit",title:"Onderzoek twee tekststappen",
    goal:"Afgewerkt betekent niet gepubliceerd",
    tasks:[
      {id:"task-clean",title:"Bewerk tekst",taskKind:"text-normalize",
        dependsOn:[],input:{text:"GEHEIME INVOER  "}},
      {id:"task-count",title:"Tel woorden",taskKind:"text-metrics",
        dependsOn:["task-clean"],textFrom:"task-clean"},
    ],
  };
  return applyOps(emptyOps(),{id:"product-line-"+(++id),
    at:"2026-11-10T10:00:00.000Z",actor:person,
    event:{type:"mission.create",plan}});
};
test("production line status is derived read-only, does not promote or release output",()=>{
  const state=stateWithMission(),original=structuredClone(state);
  const line=productionLineView(state,runtime,true);
  assert.equal(line.schema,"eai-production-line-v1");
  assert.equal(line.releaseGate,"candidate-review-only");
  assert.equal(line.independentOperationsWitness,false);
  assert.equal(line.operationsJournalVerified,true);
  assert.equal(line.missions.length,1);
  const m=line.missions[0];
  assert.equal(m.revision,1);
  assert.deepEqual(m.stages.map(s=>s.id),["plan","workers","execute","review","release"]);
  assert.equal(m.nextAction.kind,"inspect-worker");
  assert.equal(m.nextAction.target,"registratie");
  assert.equal(m.publication.allowed,false);
  assert.equal(m.stages[4].status,"not-verified");
  assert.equal(JSON.stringify(line).includes("GEHEIME INVOER"),false);
  assert.deepEqual(state,original);
});
test("production overview API uses existing audit authorization and omits task inputs",async()=>{
  const demo=createDemoServer({schedulerIntervalMs:0});
  try{
    await new Promise<void>(done=>demo.server.listen(0,"127.0.0.1",done));
    const url="http://127.0.0.1:"+(demo.server.address() as AddressInfo).port;
    assert.equal((await fetch(url+"/ops/production-line")).status,401);
    assert.equal((await fetch(url+"/ops/production-line",{
      headers:{authorization:"Bearer "+demo.workerToken}})).status,403);
    const reply=await fetch(url+"/ops/production-line",{
      headers:{authorization:"Bearer "+demo.token},cache:"no-store",
    });
    assert.equal(reply.status,200);
    const line=await reply.json() as ReturnType<typeof productionLineView>;
    assert.equal(line.schema,"eai-production-line-v1");
    assert.equal(line.operationsJournalVerified,true);
    assert.equal(line.releaseGate,"candidate-review-only");
    assert.ok(Array.isArray(line.missions));
    assert.ok(line.missions.length>0);
    assert.equal(line.summary.missions,line.missions.length);
    assert.ok(line.missions.every(m=>m.publication.allowed===false));
    assert.equal(JSON.stringify(line).includes("Hallo  EAIwork"),false);
    assert.equal(JSON.stringify(line).includes("inputHash"),false);
    assert.equal((await fetch(url+"/ops/verify",{
      headers:{authorization:"Bearer "+demo.token}})).status,200);
  }finally{await demo.close()}
});
test("existing dashboard loads verified production line, never starts it from display code",()=>{
  const html=readFileSync(new URL("../prototypes/dashboard/index.html",import.meta.url),"utf8");
  assert.match(html,/fetch\('\/ops\/production-line'/);
  assert.match(html,/function liveProductionLine\(/);
  assert.match(html,/operationsJournalVerified!==true/);
  assert.match(html,/s\.productionLine=line/);
  assert.match(html,/liveProductionLine\(\)/);
  assert.match(html,/case 'production-line-open'/);
  assert.match(html,/Vrijgave: nog niet beschikbaar/);
  assert.doesNotMatch(html,/fetch\(['"]https?:\/\//);
});

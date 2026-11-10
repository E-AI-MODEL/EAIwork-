import {test} from "node:test";
import assert from "node:assert/strict";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "../scripts/local-demo.ts";
import {applyOps,emptyOps,type OpsActor,type OpsEvent} from "../packages/operations/src/registry.ts";
import {productionLineView} from "../packages/operations/src/production-line.ts";
import type {RuntimeInventory} from "../packages/operations/src/selector.ts";

const sha="a".repeat(40);
const candidate=()=>({
  repository:"E-AI-MODEL/EAIwork-",commitSha:sha,
  artifactPath:"dist/demo.zip",artifactSha256:"b".repeat(64),
  ciHeadSha:sha,ciRunUrl:"https://github.com/E-AI-MODEL/EAIwork-/actions/runs/42700000000",
  licenseRef:"LICENSE",checkNames:["unit","integration","build"],
});
const plan=(id:string)=>({
  id,title:"Release van twee teksttaken",goal:"Controleer uitkomsten zonder automatisch publiceren",
  tasks:[{id:"task-one",title:"Tekst",taskKind:"text-normalize",dependsOn:[],
    input:{text:"  Hallo  "}}],
});
let counter=0;
const owner:OpsActor={kind:"person",id:"person:owner"};
const reviewer:OpsActor={kind:"person",id:"person:reviewer"};
const commit=(state:ReturnType<typeof emptyOps>,event:OpsEvent,actor=owner)=>
  applyOps(state,{id:"release-event-"+(++counter),at:"2026-11-10T11:00:00Z",actor,event});
test("release dossier requires finished tasks, an exact revision and separate review",()=>{
  const id="mission-release-unit";
  let state=commit(emptyOps(),{type:"mission.create",plan:plan(id)});
  const submit=()=>({type:"mission.release.submit" as const,missionId:id,
    expectedRevision:1,candidate:candidate()});
  assert.throws(()=>commit(state,submit()),/all mission tasks must finish/);
  const run={runId:"run-release-1",workerId:"text-normalize",workerVersion:"1.0.0",
    adapterId:"text-normalize",inputHash:"a".repeat(64),
    startedAt:"2026-11-10T11:00:00Z",verification:"not-evaluated" as const};
  const system:OpsActor={kind:"system",id:"system:mission-runner"};
  state=commit(state,{type:"task.started",missionId:id,taskId:"task-one",run},system);
  state=commit(state,{type:"task.completed",missionId:id,taskId:"task-one",
    runId:run.runId,finishedAt:"2026-11-10T11:00:01Z",elapsedMs:1000,
    output:{text:"Hallo",changed:true},outputHash:"c".repeat(64)},system);
  assert.throws(()=>commit(state,{...submit(),expectedRevision:2}),/stale release dossier revision/);
  assert.throws(()=>commit(state,submit(),reviewer),/only the mission owner/);
  assert.throws(()=>commit(state,{...submit(),candidate:{...candidate(),ciHeadSha:"f".repeat(40)}}),
    /CI head must match/);
  assert.throws(()=>commit(state,{...submit(),candidate:{...candidate(),artifactPath:"../private/file"}}),
    /invalid artifact path/);
  state=commit(state,submit());
  assert.throws(()=>commit(state,submit()),/already submitted/);
  const review=()=>({type:"mission.release.review" as const,missionId:id,
    expectedRevision:1,decision:"external-verification-needed" as const,
    reason:"Controleer de GitHub-run en artefactbytes buiten het modelsysteem"});
  assert.throws(()=>commit(state,review()),/separate human reviewer/);
  state=commit(state,review(),reviewer);
  assert.equal(state.missions[id].releaseDossier?.review?.by,reviewer.id);
  assert.equal(state.missions[id].releaseDossier?.review?.decision,"external-verification-needed");
  assert.throws(()=>commit(state,review(),reviewer),/no current unreviewed release dossier/);
  const runtime:RuntimeInventory={adapterIds:[],capabilities:[],
    grantedPermissions:[],supportedModelSizes:["deterministic"]};
  const projected=productionLineView(state,runtime,true);
  assert.equal(projected.missions[0].publication.allowed,false);
  assert.equal(projected.missions[0].releaseDossier?.reviewDecision,"external-verification-needed");
  assert.equal(projected.missions[0].stages[4].status,"needs-review");
});
test("API keeps release proposal unverified and restricts submission and independent review",async()=>{
  const demo=createDemoServer({schedulerIntervalMs:0});
  try{
    await new Promise<void>(done=>demo.server.listen(0,"127.0.0.1",done));
    const base="http://127.0.0.1:"+(demo.server.address() as AddressInfo).port;
    const post=(url:string,body:unknown,token=demo.token)=>fetch(base+url,{
      method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},
      body:JSON.stringify(body),
    });
    const get=(url:string,token=demo.token)=>fetch(base+url,{
      headers:{authorization:"Bearer "+token},
    });
    const id="mission-release-api";
    assert.equal((await post("/ops/missions",{plan:plan(id)})).status,201);
    const route="/ops/missions/"+id+"/release/";
    assert.equal((await post(route+"submit",{expectedRevision:1,candidate:candidate()})).status,422);
    assert.equal((await post("/ops/missions/"+id+"/step",{})).status,200);
    assert.equal((await post(route+"submit",{expectedRevision:0,candidate:candidate()})).status,409);
    assert.equal((await post(route+"submit",{expectedRevision:1,candidate:candidate(),publish:true})).status,422);
    assert.equal((await post(route+"submit",{expectedRevision:1,candidate:candidate()},demo.reviewerToken)).status,403);
    const result=await post(route+"submit",{expectedRevision:1,candidate:candidate()});
    assert.equal(result.status,201);
    assert.equal((await result.json() as any).publicationAllowed,false);
    assert.equal((await post("/ops/events",{type:"mission.release.review",
      missionId:id,expectedRevision:1,decision:"external-verification-needed",
      reason:"Onbevestigd"})).status,403);
    assert.equal((await post(route+"review",{expectedRevision:1,
      decision:"external-verification-needed",reason:"Nog geen onafhankelijke artefactcontrole"})).status,403);
    assert.equal((await post(route+"review",{expectedRevision:1,
      decision:"external-verification-needed",
      reason:"Controleer CI en artifact eerst"},demo.workerToken)).status,403);
    const reviewed=await post(route+"review",{expectedRevision:1,
      decision:"external-verification-needed",
      reason:"CI en artifact buiten EAIwork controleren"},demo.reviewerToken);
    assert.equal(reviewed.status,201);
    const view=await(await get("/ops/production-line")).json() as any;
    const record=view.missions.find((x:any)=>x.id===id);
    assert.equal(record.releaseDossier?.repository,"E-AI-MODEL/EAIwork-");
    assert.equal(record.releaseDossier?.reviewDecision,"external-verification-needed");
    assert.equal(record.publication.allowed,false);
    assert.equal(view.releaseGate,"not-implemented");
    assert.equal((await get("/ops/production-line",demo.workerToken)).status,403);
    assert.equal((await get("/ops/verify")).status,200);
  }finally{await demo.close()}
});

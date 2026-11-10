import {test} from "node:test";
import assert from "node:assert/strict";
import type {AddressInfo} from "node:net";
import {applyOps,emptyOps,type OpsState,type OpsActor,type OpsEvent} from "../packages/operations/src/registry.ts";
import {createDemoServer} from "../scripts/local-demo.ts";
import {productionLineView} from "../packages/operations/src/production-line.ts";
import type {RuntimeInventory} from "../packages/operations/src/selector.ts";

const owner:OpsActor={kind:"person",id:"person:owner"};
const reviewer:OpsActor={kind:"person",id:"person:reviewer"};
const runner:OpsActor={kind:"system",id:"system:mission-runner"};
const at="2026-11-10T12:00:00Z";
let seq=0;
const add=(state:OpsState,event:OpsEvent,actor=owner)=>applyOps(state,{
  id:"release-test-"+(++seq),at,actor,event,
});
const plan={
  id:"mission-release-unit",title:"Technische tekstcontrole",
  goal:"Bewaar uitvoering en beoordeel software apart",
  tasks:[{id:"task-clean",title:"Opschonen",taskKind:"text-normalize",
    dependsOn:[],input:{text:"  test  "}}],
};
const candidate=(id="release-review-one")=>({
  id,revision:1,repository:"E-AI-MODEL/EAIwork-",
  commitSha:"a".repeat(40),artifactName:"release.zip",
  artifactSha256:"b".repeat(64),
  checkRunUrl:"https://github.com/E-AI-MODEL/EAIwork-/actions/runs/42802394496",
  checkCommitSha:"a".repeat(40),
});
const completed=()=>{
  let state=add(emptyOps(),{type:"mission.create",plan});
  state=add(state,{type:"task.started",missionId:plan.id,taskId:"task-clean",run:{
    runId:"run-release-test",workerId:"text-normalize",workerVersion:"1.0.0",
    adapterId:"text-normalize",inputHash:"c".repeat(64),startedAt:at,
    verification:"not-evaluated",
  }},runner);
  state=add(state,{type:"task.completed",missionId:plan.id,taskId:"task-clean",
    runId:"run-release-test",finishedAt:at,elapsedMs:0,
    output:{text:"test",changed:true},outputHash:"d".repeat(64)},runner);
  return state;
};
const runtime:RuntimeInventory={adapterIds:[],capabilities:[],
  grantedPermissions:[],supportedModelSizes:["deterministic"]};

test("candidate records exact references but cannot publish or pass CI by assertion",()=>{
  const initial=completed();
  const first=add(initial,{type:"mission.release.propose",
    missionId:plan.id,candidate:candidate()});
  const stored=first.missions[plan.id].releaseCandidates!["release-review-one"];
  assert.equal(stored.status,"pending-review");
  assert.equal(stored.proposedBy,owner.id);
  assert.equal(stored.outputHashes["task-clean"],"d".repeat(64));
  assert.equal(initial.missions[plan.id].releaseCandidates,undefined);
  const display=productionLineView(first,runtime,true);
  assert.equal(display.missions[0].releaseCandidate?.status,"pending-review");
  assert.equal(display.missions[0].nextAction.kind,"review-release-candidate");
  assert.equal(display.missions[0].publication.allowed,false);
  assert.equal(display.releaseGate,"candidate-review-only");
  assert.equal(display.missions[0].stages[4].status,"needs-review");
  assert.equal(JSON.stringify(display).includes("  test  "),false);
  assert.equal(JSON.stringify(display).includes("artifactSha256"),false);
  assert.throws(()=>add(first,{type:"mission.release.review",missionId:plan.id,
    candidateId:"release-review-one",decision:"accept-for-verification",
    reason:"Zelf goedgekeurd"},owner),/different human reviewer/);
  const reviewed=add(first,{type:"mission.release.review",missionId:plan.id,
    candidateId:"release-review-one",decision:"accept-for-verification",
    reason:"De documentatie is bekeken, CI en bestandshash moeten nog onafhankelijk worden gecontroleerd."},reviewer);
  const actual=reviewed.missions[plan.id].releaseCandidates!["release-review-one"];
  assert.equal(actual.status,"accepted-for-verification");
  assert.equal(actual.review?.by,reviewer.id);
  assert.equal(productionLineView(reviewed,runtime,true).missions[0].publication.allowed,false);
  assert.throws(()=>add(reviewed,{type:"mission.release.review",missionId:plan.id,
    candidateId:"release-review-one",decision:"request-changes",
    reason:"Achteraf veranderd"},reviewer),/unknown or stale/);
});
test("incomplete work, forged checks, bad digests and duplicate pending reviews fail closed",()=>{
  let state=add(emptyOps(),{type:"mission.create",plan});
  assert.throws(()=>add(state,{type:"mission.release.propose",missionId:plan.id,
    candidate:candidate()}),/all tasks must finish/);
  state=completed();
  for(const bad of [
    {...candidate(),commitSha:"ab",checkCommitSha:"ab"},
    {...candidate(),checkCommitSha:"c".repeat(40)},
    {...candidate(),artifactSha256:"not-a-hash"},
    {...candidate(),checkRunUrl:"https://example.com/actions/runs/123"},
    {...candidate(),repository:"E-AI-MODEL/another-repo"},
    {...candidate(),artifactName:"../release.zip"},
    {...candidate(),revision:2},
  ]){
    assert.throws(()=>add(state,{type:"mission.release.propose",
      missionId:plan.id,candidate:bad}),/release|stale/);
  }
  state=add(state,{type:"mission.release.propose",missionId:plan.id,candidate:candidate()});
  assert.throws(()=>add(state,{type:"mission.release.propose",
    missionId:plan.id,candidate:candidate("release-second")}),/already pending/);
});
test("a plan revision supersedes an old candidate and blocks its later review",()=>{
  let state=completed();
  state=add(state,{type:"mission.release.propose",missionId:plan.id,candidate:candidate()});
  const extended={...plan,tasks:[...plan.tasks,{
    id:"task-count",title:"Tellen",taskKind:"text-metrics",
    dependsOn:["task-clean"],textFrom:"task-clean",
  }]};
  state=add(state,{type:"mission.extend",missionId:plan.id,
    expectedRevision:1,plan:extended});
  assert.equal(state.missions[plan.id].revision,2);
  assert.equal(state.missions[plan.id].releaseCandidates!["release-review-one"].status,"superseded");
  assert.throws(()=>add(state,{type:"mission.release.review",missionId:plan.id,
    candidateId:"release-review-one",decision:"accept-for-verification",
    reason:"Oude versie"},reviewer),/unknown or stale/);
});
test("HTTP requires separate reviewer and keeps CI evidence unverified",async()=>{
  const demo=createDemoServer({schedulerIntervalMs:0});
  try{
    await new Promise<void>(ok=>demo.server.listen(0,"127.0.0.1",ok));
    const base="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
    const call=(method:string,path:string,body?:unknown,token=demo.token)=>fetch(base+path,{
      method,headers:{authorization:"Bearer "+token,
        ...(body?{"content-type":"application/json"}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),
    });
    const missionId="mission-demo-text";
    const path="/ops/missions/"+missionId+"/releases/candidates";
    assert.equal((await call("POST",path,candidate(),"wrong")).status,401);
    assert.equal((await call("POST",path,candidate(),demo.workerToken)).status,403);
    const rejected=await call("POST",path,{...candidate(),customPower:"publish"});
    assert.equal(rejected.status,422);
    assert.equal((await call("POST",path,candidate())).status,201);
    const listUrl="/ops/missions/"+missionId+"/releases";
    let list=await(await call("GET",listUrl)).json() as any;
    assert.equal(list.candidates.length,1);
    assert.equal(list.publicationAllowed,false);
    assert.equal(list.candidates[0].status,"pending-review");
    const reviewUrl="/ops/missions/"+missionId+"/releases/release-review-one/review";
    assert.equal((await call("POST",reviewUrl,{
      decision:"accept-for-verification",reason:"Eigen goedkeuring",
    })).status,422);
    const accepted=await call("POST",reviewUrl,{
      decision:"accept-for-verification",reason:"Handmatig beoordeeld; onafhankelijke CI-controle volgt.",
    },demo.reviewerToken);
    assert.equal(accepted.status,200);
    assert.equal((await accepted.json() as any).publicationAllowed,false);
    assert.equal((await call("POST",reviewUrl,{
      decision:"request-changes",reason:"Nogmaals",
    },demo.reviewerToken)).status,422);
    list=await(await call("GET",listUrl)).json() as any;
    assert.equal(list.candidates[0].status,"accepted-for-verification");
    const line=await(await call("GET","/ops/production-line")).json() as any;
    const m=line.missions.find((x:any)=>x.id===missionId);
    assert.equal(m.releaseCandidate.status,"accepted-for-verification");
    assert.equal(m.publication.allowed,false);
    assert.equal(line.releaseGate,"candidate-review-only");
    assert.equal((await call("POST","/ops/events",{
      type:"mission.release.review",missionId,candidateId:"release-review-one",
      decision:"accept-for-verification",reason:"spoof"},demo.reviewerToken)).status,403);
    assert.equal((await call("GET","/ops/verify")).status,200);
  }finally{await demo.close()}
});

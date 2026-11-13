import {test} from "node:test";
import assert from "node:assert/strict";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "../scripts/local-demo.ts";
import {verifyGitHubActionsRun,type GitHubReader} from "../packages/operations/src/github-actions.ts";

const sha="a".repeat(40);
const candidate=()=>({
  repository:"E-AI-MODEL/EAIwork-",commitSha:sha,
  ciHeadSha:sha,ciRunUrl:"https://github.com/E-AI-MODEL/EAIwork-/actions/runs/42700000000",
  artifactPath:"dist/test.zip",artifactSha256:"b".repeat(64),
  licenseRef:"LICENSE",checkNames:["tests"],
});
const goodRun=()=>({id:42700000000,repository:{full_name:"E-AI-MODEL/EAIwork-"},
  head_sha:sha,status:"completed",conclusion:"success",run_attempt:1});
const reader=(run:unknown):GitHubReader=>async(url,init)=>{
  assert.equal(url,"https://api.github.com/repos/E-AI-MODEL/EAIwork-/actions/runs/42700000000");
  assert.equal(init.method,"GET");
  assert.equal(init.redirect,"error");
  assert.equal((init.headers as Record<string,string>).authorization,undefined);
  return new Response(JSON.stringify(run),{
    status:200,headers:{"content-type":"application/json"},
  });
};
test("GitHub verifier checks exact official run, repository, SHA, success and attempt",async()=>{
  const result=await verifyGitHubActionsRun(candidate(),reader(goodRun()));
  assert.equal(result.runId,42700000000);
  assert.equal(result.commitSha,sha);
  assert.equal(result.source,"github-actions-api");
  assert.equal(result.result,"success");
  for(const wrong of [
    {...goodRun(),head_sha:"c".repeat(40)},
    {...goodRun(),repository:{full_name:"different/repo"}},
    {...goodRun(),id:42700000001},
    {...goodRun(),status:"in_progress",conclusion:null},
    {...goodRun(),conclusion:"failure"},
    {...goodRun(),run_attempt:0},
  ])await assert.rejects(verifyGitHubActionsRun(candidate(),reader(wrong)));
  await assert.rejects(verifyGitHubActionsRun(
    {...candidate(),ciRunUrl:"https://example.invalid/actions/runs/42700000000"},
    reader(goodRun())),/invalid GitHub Actions run URL/);
  await assert.rejects(verifyGitHubActionsRun(candidate(),async()=>new Response("not found",{status:404})),
    /HTTP 404/);
  await assert.rejects(verifyGitHubActionsRun(candidate(),async()=>new Response("x".repeat(100000))),
    /response too large/);
});
test("CI verification endpoint writes a trusted observation but never releases software",async()=>{
  let calls=0;
  const demo=createDemoServer({
    schedulerIntervalMs:0,
    githubActionReader:async(url,init)=>{
      calls++;
      return reader(goodRun())(url,init);
    },
  });
  try{
    await new Promise<void>(done=>demo.server.listen(0,"127.0.0.1",done));
    const base="http://127.0.0.1:"+(demo.server.address() as AddressInfo).port;
    const post=(path:string,data:unknown,token=demo.token)=>fetch(base+path,{
      method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},
      body:JSON.stringify(data),
    });
    const get=(path:string)=>fetch(base+path,{headers:{authorization:"Bearer "+demo.token}});
    const id="mission-github-verification";
    const plan={id,title:"CI-aanvulling",goal:"Verifieer CI voor een afgeronde taak",
      tasks:[{id:"task-clean",title:"Bewerken",taskKind:"text-normalize",
        dependsOn:[],input:{text:"  Klaar  "}}]};
    assert.equal((await post("/ops/missions",{plan})).status,201);
    assert.equal((await post("/ops/missions/"+id+"/step",{})).status,200);
    assert.equal((await post("/ops/missions/"+id+"/release/submit",
      {expectedRevision:1,candidate:candidate()})).status,201);
    assert.equal((await post("/ops/events",{type:"mission.release.ci.observe",
      missionId:id,expectedRevision:1,observation:{
        source:"github-actions-api",runId:42700000000,attempt:1,
        commitSha:sha,observedAt:new Date().toISOString(),result:"success",
      }})).status,403);
    const path="/ops/missions/"+id+"/release/verify-ci";
    assert.equal((await post(path,{},demo.workerToken)).status,403);
    assert.equal((await post(path,{force:true})).status,422);
    assert.equal(calls,0);
    const response=await post(path,{});
    assert.equal(response.status,200);
    assert.equal((await response.json() as any).publicationAllowed,false);
    assert.equal(calls,1);
    assert.equal((await post(path,{})).status,409);
    assert.equal(calls,1);
    const line=await(await get("/ops/production-line")).json() as any;
    const item=line.missions.find((m:any)=>m.id===id);
    assert.equal(item.releaseDossier.ciVerification,"github-confirmed");
    assert.equal(item.releaseDossier.ciAttempt,1);
    assert.equal(item.publication.allowed,false);
    assert.equal(line.releaseGate,"not-implemented");
    assert.equal((await get("/ops/verify")).status,200);
  }finally{await demo.close()}
});
test("failed GitHub CI response leaves the dossier unverified",async()=>{
  const demo=createDemoServer({
    schedulerIntervalMs:0,
    githubActionReader:reader({...goodRun(),conclusion:"failure"}),
  });
  try{
    await new Promise<void>(done=>demo.server.listen(0,"127.0.0.1",done));
    const base="http://127.0.0.1:"+(demo.server.address() as AddressInfo).port;
    const post=(path:string,data:unknown)=>fetch(base+path,{
      method:"POST",headers:{authorization:"Bearer "+demo.token,"content-type":"application/json"},
      body:JSON.stringify(data),
    });
    const id="mission-github-run-failed";
    assert.equal((await post("/ops/missions",{plan:{id,title:"Foute CI-run",goal:"Houd vrijgave tegen",
      tasks:[{id:"task-clean",title:"Tekst",taskKind:"text-normalize",
        dependsOn:[],input:{text:"  Klaar  "}}]}})).status,201);
    assert.equal((await post("/ops/missions/"+id+"/step",{})).status,200);
    assert.equal((await post("/ops/missions/"+id+"/release/submit",
      {expectedRevision:1,candidate:candidate()})).status,201);
    assert.equal((await post("/ops/missions/"+id+"/release/verify-ci",{})).status,422);
    const state=await(await fetch(base+"/ops/missions",{
      headers:{authorization:"Bearer "+demo.token}})).json() as any;
    assert.equal(state.missions[id].releaseDossier.ciObservation,undefined);
  }finally{await demo.close()}
});

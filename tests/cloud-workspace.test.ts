import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {applyOps,emptyOps} from "../packages/operations/src/registry.ts";
import {cloudTransition,cloudView,validateCloudAction,digest} from "../packages/cloud/src/controller.ts";

const owner="person:cloud-owner";
const commit=async(state:any,input:unknown)=>{
  const result=await cloudTransition(state,input,owner);
  assert.deepEqual(result.events.reduce((s,event)=>applyOps(s,event),state),result.next);
  return result;
};
test("Browser mission -> same native Builder -> fixture -> human release -> native runner",async()=>{
  let state=emptyOps();
  const created=await commit(state,{type:"create",title:"Tekst voor de proef",
    text:"  Hallo    Cloudflare\r\nEAIwork  "});
  state=created.next;
  assert.equal(created.events[0].event.type,"mission.create");
  const id=created.result.missionId as string;
  assert.match(id,/^mission-[a-z0-9]{20}$/);
  assert.equal(state.missions[id].tasks["task-inspect"].status,"queued");
  await assert.rejects(commit(state,{type:"run",missionId:id}),/Geen vrijgegeven/);
  const built=await commit(state,{type:"prepare",missionId:id});
  state=built.next;
  assert.equal(built.events.length,2);
  assert.deepEqual(built.events.map(x=>x.event.type),["worker.register","quality.record"]);
  assert.equal(built.events[1].actor.id,"check:builtins");
  assert.equal(state.workers["text-inspector"].stage,"candidate");
  assert.equal(state.measurements[0].numerator,3);
  await assert.rejects(commit(state,{type:"run",missionId:id}),/Geen vrijgegeven/);
  await assert.rejects(commit(state,{type:"prepare",missionId:id}),/Er bestaat al een worker/);
  const approved=await commit(state,{type:"release",missionId:id});
  state=approved.next;
  assert.equal(state.workers["text-inspector"].stage,"ready");
  assert.ok(state.workers["text-inspector"].releaseEvidence);
  const ran=await commit(state,{type:"run",missionId:id});
  state=ran.next;
  assert.deepEqual(ran.events.map(x=>x.event.type),["task.started","task.completed"]);
  assert.ok(ran.events.every(x=>x.actor.id==="system:mission-runner"));
  assert.equal(state.missions[id].tasks["task-inspect"].run?.output?.words,3);
  assert.equal(state.missions[id].tasks["task-inspect"].run?.verification,"not-evaluated");
  assert.equal(cloudView(state).missions[0].progress.status,"complete");
  await assert.rejects(commit(state,{type:"run",missionId:id}),/niet klaar/);
});
test("Unknown, injected or external effect requests do not change the native state",async()=>{
  const state=emptyOps();
  for(const payload of [
    {type:"execute",command:"rm -rf /"},
    {type:"create",title:"A",text:"",effect:"publish"},
    {type:"create",title:"B",text:"  Hallo ",model:"unbounded"},
    {type:"run",missionId:"../../wrong"},
    {type:"prepare",missionId:"mission-nope",allowPublish:true},
  ])await assert.rejects(commit(state,payload));
  assert.equal(state.history.length,0);
});
test("Only original actor may make a human decision",async()=>{
  const added=await commit(emptyOps(),{type:"create",title:"Proef",text:"Test"});
  await assert.rejects(cloudTransition(added.next,
    {type:"prepare",missionId:added.result.missionId},"person:somebody-else"),/Alleen de eigenaar/);
});
test("Shared contract and fixtures retain compatible input and output hashes",async()=>{
  const a=await digest({text:"Hello"});
  const b=await digest({text:"Hello"});
  assert.equal(a,b);
  assert.match(a,/^[a-f0-9]{64}$/);
});
test("Cloudflare worker cannot process private data without Access identity",()=>{
  const worker=readFileSync(new URL("../packages/cloud/src/worker.ts",import.meta.url),"utf8");
  const cfg=readFileSync(new URL("../cloudflare.config.ts",import.meta.url),"utf8");
  assert.match(worker,/ctx\.access\.aud!==audience/);
  assert.match(worker,/getIdentity\(\)/);
  assert.match(worker,/EAI_ALLOWED_EMAIL/);
  assert.match(worker,/EAI_ACCESS_AUD/);
  assert.match(worker,/request\.headers\.get\("origin"\)!==url\.origin/);
  assert.match(worker,/journal hash mismatch/);
  assert.match(cfg,/name:"eaiwork"/);
  assert.match(cfg,/previewUrls:false/);
  assert.match(cfg,/workersDev:true/);
  assert.doesNotMatch(cfg,/eaimodel\.nl\/\*/);
  assert.doesNotMatch(worker,/eval\(|new Function\(/);
});

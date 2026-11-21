import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {applyOps,emptyOps} from "../packages/operations/src/registry.ts";
import {chooseExecutionSite,CLOUD_PILOT_SITES} from "../packages/operations/src/execution-site.ts";
import {cloudTransition,cloudView,validateCloudAction,cloudRequestKind,cloudNeedsSource,digest} from "../packages/cloud/src/controller.ts";

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

test("Free instruction is preserved and an unsupported code request is never marked done",async()=>{
  const instruction="Bouw een interactief dashboard met grafieken en filters.";
  const result=await commit(emptyOps(),{type:"submit",instruction,sourceText:"voorbeelddataset"});
  const id=result.result.missionId as string;
  assert.equal(result.result.stage,"unsupported");
  assert.equal(result.events.length,1);
  assert.equal(result.next.missions[id].plan.sourceInstruction,instruction);
  assert.equal(result.next.missions[id].tasks["task-inspect"].spec.taskKind,"request-review");
  assert.equal(result.next.missions[id].tasks["task-inspect"].status,"queued");
  const view=cloudView(result.next).missions[0];
  assert.equal(view.requestedOutcome,instruction);
  assert.equal(view.need?.status,"unsupported");
  assert.equal(view.output,null);
  await assert.rejects(commit(result.next,{type:"prepare",missionId:id}),/niet geschikt/);
  await assert.rejects(commit(result.next,{type:"run",missionId:id}),/niet geschikt/);
});
test("Free text request reuses released native Builder worker and records a real run",async()=>{
  let state=emptyOps();
  const initial=await commit(state,{type:"create",title:"Eerste controle",text:"een"});
  state=initial.next;const id=initial.result.missionId as string;
  state=(await commit(state,{type:"prepare",missionId:id})).next;
  state=(await commit(state,{type:"release",missionId:id})).next;
  const work=await commit(state,{type:"submit",
    instruction:"Tel de woorden, tekens en regels in deze tekst.",
    sourceText:"  Een  tweede test\\r\\nMet drie regels. "});
  assert.equal(work.result.stage,"done");
  assert.deepEqual(work.events.map(e=>e.event.type),
    ["mission.create","task.started","task.completed"]);
  const mission=work.next.missions[work.result.missionId as string];
  assert.equal(mission.tasks["task-inspect"].status,"done");
  assert.equal(mission.tasks["task-inspect"].run?.verification,"not-evaluated");
  assert.equal(cloudView(work.next).missions[0].progress.status,"complete");
  assert.equal(cloudView(work.next).missions[0].need,null);
});
test("Intake rejects ambiguous instruction and never infers a code-building capability",async()=>{
  assert.equal(cloudRequestKind("build","dit is brondata"),"request-review");
  assert.equal(cloudRequestKind("Controleer of de Worker Builder werkt","Testtekst"),"request-review");
  assert.equal(cloudRequestKind("Tel woorden in deze tekst",""),"request-review");
  assert.equal(cloudRequestKind("Tel woorden in deze tekst","test"),"text-inspect");
  const state=emptyOps();
  for(const input of [
    {type:"submit",instruction:"",sourceText:"test"},
    {type:"submit",instruction:"A".repeat(1501)},
    {type:"submit",instruction:"Opdracht",sourceText:"X".repeat(10001)},
    {type:"submit",instruction:"Tel woorden",sourceText:"abc",publish:true},
  ])await assert.rejects(commit(state,input));
  assert.equal(state.history.length,0);
});
test("New private UI shows a single selected result and not a wall of raw JSON",()=>{
  const ui=readFileSync(new URL("../packages/cloud/src/ui.ts",import.meta.url),"utf8");
  assert.match(ui,/Wat wil je gedaan krijgen/);
  assert.match(ui,/type:"submit"/);
  assert.match(ui,/showDetails/);
  assert.match(ui,/textContent/);
  assert.match(ui,/Uitvoergegevens bekijken/);
  assert.doesNotMatch(ui,/innerHTML/);
});

test("Missing source is rejected before creating an incomplete text inspection",async()=>{
  assert.equal(cloudNeedsSource("Tel de woorden, tekens en regels in mijn tekst."),true);
  assert.equal(cloudNeedsSource("Bouw een dashboard met Excelgegevens."),false);
  const state=emptyOps();
  await assert.rejects(commit(state,{type:"submit",
    instruction:"Tel de woorden, tekens en regels in mijn tekst."}),/brontekst/);
  await assert.rejects(commit(state,{type:"submit",
    instruction:"Tel de woorden in mijn tekst.",sourceText:"   "}),/brontekst/);
  assert.equal(Object.keys(state.missions).length,0);
});
test("Older incomplete text missions are correctly labeled source-required",()=>{
  const instruction="Tel de woorden, tekens en regels in mijn tekst.";
  const state=applyOps(emptyOps(),{
    id:"event-test-legacy",at:"2026-11-21T08:00:00.000Z",
    actor:{kind:"person",id:owner},
    event:{type:"mission.create",plan:{
      id:"mission-legacy-incomplete",title:instruction,goal:instruction,
      sourceInstruction:instruction,
      tasks:[{id:"task-inspect",title:"Nog niet ondersteunde opdracht",
        taskKind:"request-review",effect:"local",dependsOn:[],input:{text:instruction}}]
    }}
  });
  const row=cloudView(state).missions[0];
  assert.equal(row.status,"queued");
  assert.equal(row.sourceMissing,true);
  assert.equal(row.need?.status,"source-required");
  assert.equal(row.output,null);
});
test("Mobile missions show either the list or the selected detail, with return action",()=>{
  const ui=readFileSync(new URL("../packages/cloud/src/ui.ts",import.meta.url),"utf8");
  assert.match(ui,/data-pane="list"/);
  assert.match(ui,/data-pane="detail"/);
  assert.match(ui,/Terug naar opdrachten/);
  assert.match(ui,/Brontekst toevoegen/);
  assert.match(ui,/Brontekst ontbreekt/);
  assert.doesNotMatch(ui,/innerHTML/);
});

test("Mobile workspace fits the viewport and switches between real task and creation panels",async()=>{
  const ui=await import("../packages/cloud/src/ui.ts");
  const {Script}=await import("node:vm");
  assert.doesNotThrow(()=>new Script(ui.javascript));
  assert.match(ui.html,/id="tab-create"/);
  assert.match(ui.html,/id="tab-work"/);
  assert.match(ui.html,/id="create-panel"/);
  assert.match(ui.html,/id="work-panel"/);
  assert.match(ui.html,/height:100dvh/);
  assert.match(ui.html,/overflow:hidden/);
  assert.match(ui.html,/\.layout\[data-mobile-view="create"\] #work-panel\{display:none\}/);
  assert.match(ui.html,/\.layout\[data-mobile-view="work"\] #create-panel\{display:none\}/);
  assert.match(ui.html,/\.mission-list\{flex:1;min-height:0;max-height:none;overflow-y:auto/);
  assert.match(ui.javascript,/showMobile\("create"\)/);
  assert.match(ui.javascript,/showMobile\("work"\)/);
  assert.match(ui.javascript,/mobilePane="detail";showMobile\("work"\);render\(data\.state\)/);
  assert.match(ui.html,/Gebruik voorlopig alleen onschuldige testgegevens/);
  assert.doesNotMatch(ui.javascript,/innerHTML/);
});

test("Owner may choose local, cloud or auto, but preference cannot grant authority",async()=>{
  const task="text-inspect";
  assert.equal(chooseExecutionSite(task,"cloud",CLOUD_PILOT_SITES).site,"cloud");
  assert.equal(chooseExecutionSite(task,"auto",CLOUD_PILOT_SITES).site,"cloud");
  assert.equal(chooseExecutionSite(task,"local",CLOUD_PILOT_SITES).site,null);
  assert.equal(chooseExecutionSite(task,"local",CLOUD_PILOT_SITES).status,"site-unavailable");
  assert.equal(chooseExecutionSite("request-review","auto",CLOUD_PILOT_SITES).site,null);
  assert.equal(chooseExecutionSite("request-review","cloud",CLOUD_PILOT_SITES).site,null);
  assert.throws(()=>chooseExecutionSite(task,"remote" as any,CLOUD_PILOT_SITES));
  assert.throws(()=>chooseExecutionSite(task,"auto",[{id:"cloud",connected:true,taskKinds:[task]},
    {id:"cloud",connected:true,taskKinds:[task]}]));
  // A local-first policy is only effective if the trusted host reports an
  // actually attached local executor. Client hints do not create one.
  const pilot=[{id:"local" as const,connected:true,taskKinds:[task]},
    {id:"cloud" as const,connected:true,taskKinds:[task]}];
  assert.equal(chooseExecutionSite(task,"auto",pilot).site,"local");
  assert.equal(chooseExecutionSite(task,"cloud",pilot).site,"cloud");
});
test("Local-only browser mission waits without cloud execution even with a released worker",async()=>{
  let state=emptyOps();
  let first=await commit(state,{type:"create",title:"De vrijgegeven worker",text:"een"});
  state=first.next;const id=first.result.missionId as string;
  state=(await commit(state,{type:"prepare",missionId:id})).next;
  state=(await commit(state,{type:"release",missionId:id})).next;
  const instruction="Tel de woorden in deze tekst";
  const created=await commit(state,{type:"submit",instruction,sourceText:"Een test",
    executionPreference:"local"});
  const id2=created.result.missionId as string;
  assert.equal(created.result.stage,"awaiting-executor");
  assert.deepEqual(created.events.map(e=>e.event.type),["mission.create"]);
  assert.equal(created.next.missions[id2].plan.executionPreference,"local");
  assert.equal(created.next.missions[id2].tasks["task-inspect"].status,"queued");
  const view=cloudView(created.next).missions.find(m=>m.id===id2)!;
  assert.equal(view.execution.site,null);
  assert.equal(view.execution.status,"site-unavailable");
  assert.equal(view.output,null);
  await assert.rejects(commit(created.next,{type:"run",missionId:id2}),/niet gekoppeld/);
  await assert.rejects(commit(created.next,{type:"prepare",missionId:id2}),/niet gekoppeld/);
  assert.equal(state.history.length+1,created.next.history.length);
});
test("Explicit cloud missions still reuse the registered, tested text worker",async()=>{
  let state=emptyOps();
  const created=await commit(state,{type:"create",title:"Bouw fixture",text:"een"});
  state=created.next;
  state=(await commit(state,{type:"prepare",missionId:created.result.missionId as string})).next;
  state=(await commit(state,{type:"release",missionId:created.result.missionId as string})).next;
  const ran=await commit(state,{type:"submit",
    instruction:"Tel de woorden in deze tekst",sourceText:"Een en twee",
    executionPreference:"cloud"});
  assert.equal(ran.result.stage,"done");
  assert.deepEqual(ran.events.map(e=>e.event.type),["mission.create","task.started","task.completed"]);
  const mission=cloudView(ran.next).missions[0];
  assert.equal(mission.execution.site,"cloud");
  assert.equal(mission.output?.words,3);
  assert.equal(mission.verification,"not-evaluated");
});
test("Execution mode in the browser is a request preference, not a trusted executor claim",async()=>{
  const state=emptyOps();
  for(const input of [
    {type:"submit",instruction:"Bouw een dashboard",executionPreference:"cloud",
      runner:{verified:true}},
    {type:"submit",instruction:"Bouw een dashboard",executionPreference:"remote"},
    {type:"submit",instruction:"Bouw een dashboard",executionPreference:true},
    {type:"submit",instruction:"Bouw een dashboard",executionPreference:null},
  ])await assert.rejects(commit(state,input));
  assert.equal(Object.keys(state.missions).length,0);
  const ui=await import("../packages/cloud/src/ui.ts");
  assert.match(ui.html,/name="exec-location" value="auto"/);
  assert.match(ui.html,/name="exec-location" value="local"/);
  assert.match(ui.html,/name="exec-location" value="cloud"/);
  assert.match(ui.javascript,/executionPreference:document\.querySelector/);
  assert.doesNotMatch(ui.javascript,/innerHTML/);
});

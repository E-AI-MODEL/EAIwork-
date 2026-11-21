import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
import {applyOps,emptyOps} from "../packages/operations/src/registry.ts";
import {cloudTransition,cloudView,digestBytes,validateCloudAction} from "../packages/cloud/src/controller.ts";
import {parseDashboardCsv,buildCsvDashboard,renderCsvDashboardHtml,
  dashboardContract,safeDashboardContract,evaluateDashboardFixtures
} from "../packages/operations/src/csv-dashboard.ts";
import {chooseExecutionSite,CLOUD_PILOT_SITES} from "../packages/operations/src/execution-site.ts";
const actor="person:cloud-owner";
const commit=async(state:any,action:unknown)=>{
  const r=await cloudTransition(state,action,actor);
  assert.deepEqual(r.events.reduce((s,e)=>applyOps(s,e),state),r.next);
  return r;
};
const instruction="Bouw een interactief dashboard van mijn CSV";
const csv="Afdeling;Maand;Aantal\nNoord;Januari;12\nZuid;Januari;18\nWest;Februari;7";

test("CSV parser handles semicolon, comma, tab, quoting and BOM",()=>{
  const a=parseDashboardCsv(csv);
  assert.deepEqual(a.columns,["Afdeling","Maand","Aantal"]);
  assert.equal(a.rows.length,3);
  assert.equal(a.separator,";");
  assert.deepEqual(parseDashboardCsv('\ufeff"Naam","Aantal"\r\n"Een, twee",3\r\nDrie,4').rows,
    [["Een, twee","3"],["Drie","4"]]);
  assert.deepEqual(parseDashboardCsv('Naam\tAantal\nA\t2\nB\t3').rows,
    [["A","2"],["B","3"]]);
  assert.deepEqual(parseDashboardCsv('Naam,Notitie\nA,"Twee\nregels"').rows,
    [["A","Twee\nregels"]]);
});
test("CSV parser refuses ambiguous, malformed, oversized and non-tabular input",()=>{
  const invalid=[
    "", "Dit is geen CSV", "Naam;Naam\nA;B","A;B\nx",
    'A;B\n"onafgesloten;42','A;B\n"af"x;2',
    "A;B\n1;2;3","A;B\n1;2\n3",
    "A;B\n1;2\n".repeat(122),
    "A;B\n"+("x".repeat(451))+";y",
    "A;B\n<script>alert(1)</script>" // only one field, incomplete
  ];
  for(const source of invalid)assert.throws(()=>parseDashboardCsv(source),source.slice(0,20));
});
test("Fixed dashboard renderer produces self-contained interactive HTML without interpreting CSV as code",async()=>{
  const input='Afdeling;Waarde\n"<script>fetch(1)</script>";12\nNoord;18';
  const preview=buildCsvDashboard(input,instruction);
  assert.equal(preview.kind,"csv-dashboard-v1");
  assert.equal(preview.rowCount,2);
  assert.equal(preview.numericColumn,1);
  const html=renderCsvDashboardHtml(preview);
  assert.match(html,/id="search"/);
  assert.match(html,/id="category"/);
  assert.match(html,/id="bars"/);
  assert.match(html,/id="rows"/);
  assert.match(html,/type="application\/json"/);
  assert.ok(!html.includes("<script>fetch(1)</script>"));
  assert.ok(html.includes("\\u003cscript\\u003efetch(1)\\u003c/script\\u003e"));
  assert.ok(!/https?:\/\//.test(html));
  const matches=html.match(/<script>\((function dashboardRuntime[\s\S]*?)\)\(\);<\/script>/);
  assert.ok(matches);
  assert.doesNotThrow(()=>new Script('('+matches![1]+')()'));
  const digest=await digestBytes(html);
  assert.match(digest,/^[a-f0-9]{64}$/);
  assert.equal(digest,await digestBytes(renderCsvDashboardHtml(preview)));
});
test("Renderer and worker contract cannot silently switch to model or arbitrary code",()=>{
  const c=dashboardContract();
  assert.equal(c.id,"csv-dashboard-renderer");
  assert.deepEqual(c.tools,[]);
  assert.deepEqual(c.requestedPermissions,[]);
  assert.equal(safeDashboardContract(c),true);
  assert.equal(safeDashboardContract({...c,tools:["shell.exec"]}),false);
  assert.equal(safeDashboardContract({...c,modelPolicy:{preferred:"large"}}),false);
  assert.equal(safeDashboardContract({...c,version:"9.0.0"}),false);
  assert.equal(safeDashboardContract({...c,recipe:{kind:"builtin-dashboard",steps:["csv-parse","dashboard-render"]}}),true);
  const fix=evaluateDashboardFixtures(c);
  assert.equal(fix.denominator,4);
  assert.equal(fix.numerator,4);
  assert.equal(fix.taskKind,"csv-dashboard");
});
test("Native EAIwork mission builds fixed dashboard worker, tests and releases after human action",async()=>{
  let state=emptyOps();
  const created=await commit(state,{type:"submit",instruction,sourceText:csv,executionPreference:"cloud"});
  state=created.next;
  const id=created.result.missionId as string;
  assert.equal(created.result.stage,"queued");
  assert.equal(state.missions[id].tasks["task-inspect"].spec.taskKind,"csv-dashboard");
  assert.equal(cloudView(state).missions[0].need?.status,"buildable");
  await assert.rejects(commit(state,{type:"run",missionId:id}),/Geen vrijgegeven/);
  const prep=await commit(state,{type:"prepare",missionId:id});
  state=prep.next;
  assert.deepEqual(prep.events.map(e=>e.event.type),["worker.register","quality.record"]);
  assert.equal(state.workers["csv-dashboard-renderer"].stage,"candidate");
  assert.equal(state.measurements[0].numerator,4);
  assert.equal(cloudView(state).missions[0].need?.status,"awaiting-release");
  await assert.rejects(commit(state,{type:"run",missionId:id}),/Geen vrijgegeven/);
  const approved=await commit(state,{type:"release",missionId:id});
  state=approved.next;
  assert.equal(state.workers["csv-dashboard-renderer"].stage,"ready");
  assert.equal(cloudView(state).missions[0].need?.status,"available");
  const ran=await commit(state,{type:"run",missionId:id});
  state=ran.next;
  assert.deepEqual(ran.events.map(e=>e.event.type),["task.started","task.completed"]);
  const run=state.missions[id].tasks["task-inspect"].run!;
  assert.equal(run.adapterId,"csv-dashboard");
  assert.equal(run.workerId,"csv-dashboard-renderer");
  assert.equal(run.verification,"not-evaluated");
  assert.equal(run.output?.kind,"csv-dashboard-v1");
  assert.equal(run.output?.rowCount,3);
  assert.match(String(run.output?.artifactSha256),/^[a-f0-9]{64}$/);
  const html=renderCsvDashboardHtml(run.output as any);
  assert.equal(await digestBytes(html),run.output?.artifactSha256);
  assert.equal(await digestBytes(renderCsvDashboardHtml(run.output as any)),run.output?.artifactSha256);
  assert.equal(cloudView(state).missions[0].progress.status,"complete");
  assert.equal(cloudView(state).missions[0].output?.kind,"csv-dashboard-v1");
  const reused=await commit(state,{type:"submit",
    instruction:"Bouw een dashboard met mijn CSV",sourceText:"Naam,Score\nA,7\nB,8",
    executionPreference:"auto"});
  assert.equal(reused.result.stage,"done");
  assert.deepEqual(reused.events.map(e=>e.event.type),
    ["mission.create","task.started","task.completed"]);
  assert.equal(reused.next.missions[reused.result.missionId as string].tasks["task-inspect"].run?.verification,
    "not-evaluated");
});
test("Explicitly local dashboard request never executes on the available cloud adapter",async()=>{
  const created=await commit(emptyOps(),{type:"submit",instruction,sourceText:csv,
    executionPreference:"local"});
  const id=created.result.missionId as string;
  assert.equal(created.result.stage,"awaiting-executor");
  assert.equal(created.events.length,1);
  assert.equal(chooseExecutionSite("csv-dashboard","local",CLOUD_PILOT_SITES).site,null);
  await assert.rejects(commit(created.next,{type:"prepare",missionId:id}),/niet gekoppeld/);
  await assert.rejects(commit(created.next,{type:"run",missionId:id}),/niet gekoppeld/);
});
test("The old bare dashboard request retains its status and can receive source later",()=>{
  assert.equal(validateCloudAction({type:"submit",instruction}).type,"submit");
  assert.equal(validateCloudAction({type:"submit",instruction,sourceText:"Dit is geen CSV"}).type,"submit");
  assert.throws(()=>validateCloudAction({type:"submit",instruction,sourceText:"Naam;Score\nA"}),/CSV/);
  const action=validateCloudAction({type:"submit",instruction,sourceText:csv,executionPreference:"cloud"});
  assert.equal(action.type,"submit");
});
test("Private artifact endpoint remains behind Access and serves hash-checked sandboxed preview",()=>{
  const worker=readFileSync(new URL("../packages/cloud/src/worker.ts",import.meta.url),"utf8");
  assert.match(worker,/await authorized\(env,ctx\)/);
  assert.match(worker,/url\.pathname==="\/api\/artifact"/);
  assert.match(worker,/await digestBytes\(html\)!==result\.artifactSha256/);
  assert.match(worker,/sandbox allow-scripts/);
  assert.match(worker,/connect-src 'none'/);
  assert.match(worker,/attachment; filename/);
  const ui=readFileSync(new URL("../packages/cloud/src/ui.ts",import.meta.url),"utf8");
  assert.match(ui,/Vul een CSV-dashboardvoorbeeld in/);
  assert.match(ui,/Open interactief voorbeeld/);
  assert.match(ui,/Download HTML/);
  assert.doesNotMatch(ui,/innerHTML/);
});

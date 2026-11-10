import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
const html=readFileSync(new URL("../prototypes/dashboard/index.html",import.meta.url),"utf8");
test("dashboard is valid self-contained JavaScript with full product navigation",()=>{
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
  assert.ok(scripts.length,"inline application script missing");
  for(const script of scripts)new Script(script,{filename:"dashboard/index.html"});
  for(const label of ["Opdrachten","Echte uitvoering","Planner en taken","Workerleger","Workerbibliotheek","Contracten en registratie","Worker Builder","Kwaliteit en drift","Menselijke besluiten","Bronnen en RepoSearch","Logboek","Instellingen"]){
    assert.ok(html.includes(label),"missing product screen: "+label);
  }
});
test("dashboard labels demo measurements and uses same-origin operations API",()=>{
  assert.match(html,/Demonstratie/);
  assert.match(html,/dash-donut/);
  assert.match(html,/dash-stages/);
  assert.match(html,/dash-bargraph/);
  assert.match(html,/Workerbibliotheek/);
  assert.match(html,/fetch\('\/ops\/catalog'/);
  assert.match(html,/fictiev/);
  assert.match(html,/fetch\('\/ops\/state'/);
  assert.match(html,/fetch\('\/ops\/events'/);
  assert.match(html,/onExecutionServer/);
  assert.match(html,/runRealMission/);
  assert.match(html,/controlRealMission/);
  assert.match(html,/ops\/missions/);
  assert.match(html,/builtin-release/);
  assert.match(html,/function liveOverview\(/);
  assert.match(html,/function liveLogbook\(/);
  assert.match(html,/function missionTracePanel\(/);
  assert.match(html,/fetchMissionTrace/);
  assert.match(html,/mission-trace-refresh/);
  assert.match(html,/case 'real-mission-open'/);
  assert.match(html,/onExecutionServer\(\)\)return s\.liveOps\?liveOverview\(\):localConnectView\(\)/);
  assert.match(html,/s.liveOps\)return liveLogbook\(\)/);
  assert.match(html,/s.liveOps\)return livePlanner\(\)/);
  assert.match(html,/s.liveOps\)return liveWorkers\(\)/);
  assert.match(html,/s.liveOps\)return liveHumanQueue\(\)/);
  assert.match(html,/function liveWorkers\(/);
  assert.match(html,/realPlannerMission/);
  assert.match(html,/ops-worker-open/);
  assert.match(html,/function automationPanel\(/);
  assert.match(html,/function controlAutomation\(/);
  assert.match(html,/updateAutomationPolling\(/);
  assert.match(html,/case 'automation-start'/);
  assert.match(html,/case 'automation-stop'/);
  assert.match(html,/automaticConsent/);
  assert.match(html,/evidenceState,evidenceDetail/);
  assert.doesNotMatch(html,/localStorage\.setItem\(/);
  assert.doesNotMatch(html,/fetch\(['"]https?:\/\//);
});

test("dashboard screen routes all point to existing functions and mobile layout is compact",()=>{
  const match=html.match(/const demoViews=\{([^}]+)\}/);
  assert.ok(match,"screen route map missing");
  for(const entry of match[1].split(",")){
    const name=entry.split(":").at(-1)?.trim()??"";
    assert.match(html,new RegExp("function\\s+"+name+"\\("),"missing renderer: "+entry);
  }
  assert.match(html,/const liveViews=\{overzicht:liveOverview/);
  assert.doesNotMatch(html,/const liveViews=\{[^}]*opdrachten:missionView/);
  assert.doesNotMatch(html,/const liveViews=\{[^}]*instellingen:settings/);
  assert.match(html,/\.app\{display:block;min-height:100vh;min-height:100dvh\}/,
    "mobile dashboard must not use two stretched CSS grid rows");
  assert.match(html,/registratie:registration/,"registration route must call the named function");
});

test("local codeworker is available only in the controlled local dashboard",()=>{
  assert.match(html,/function codeWorkbench\(/);
  assert.match(html,/codeWorkspaceStatus/);
  assert.match(html,/case 'code-apply':approveCodeProposal\(\)/);
  assert.match(html,/ops\/code\/propose/);
  assert.match(html,/ops\/code\/apply/);
  assert.match(html,/ops\/code\/check/);
  assert.match(html,/codeInspection\?\.canApply/);
});

test("local proposal diff, history and restore preserve Docker controls",()=>{
  assert.match(html,/function loadCodeHistory\(/);
  assert.match(html,/function loadCodeProposal\(/);
  assert.match(html,/function restoreCodeProposal\(/);
  assert.match(html,/code-diff-line/);
  assert.match(html,/case 'code-restore':restoreCodeProposal\(\)/);
  assert.match(html,/ops\/code\/proposals/);
  assert.match(html,/function runCodeTests\(/);
  assert.match(html,/case 'code-test':runCodeTests\(\)/);
});

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
  assert.match(html,/Voorbeeldopdrachten/);
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
  assert.match(html,/data-action="mission-trace-refresh"/);
  assert.match(html,/case 'real-mission-open'/);
  assert.match(html,/s.liveOps\)return liveOverview\(\)/);
  assert.match(html,/s.liveOps\)return liveLogbook\(\)/);
  assert.match(html,/evidenceState,evidenceDetail/);
  assert.doesNotMatch(html,/localStorage\.setItem\(/);
  assert.doesNotMatch(html,/fetch\(['"]https?:\/\//);
});

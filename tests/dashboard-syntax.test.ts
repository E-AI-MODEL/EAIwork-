import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
const html=readFileSync(new URL("../prototypes/dashboard/index.html",import.meta.url),"utf8");
test("dashboard is valid self-contained JavaScript with full product navigation",()=>{
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
  assert.ok(scripts.length,"inline application script missing");
  for(const script of scripts)new Script(script,{filename:"dashboard/index.html"});
  for(const label of ["Opdrachten","Planner en taken","Workerleger","Workerbibliotheek","Contracten en registratie","Worker Builder","Kwaliteit en drift","Menselijke besluiten","Bronnen en RepoSearch","Logboek","Instellingen"]){
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
  assert.doesNotMatch(html,/fetch\(['"]https?:\/\//);
});

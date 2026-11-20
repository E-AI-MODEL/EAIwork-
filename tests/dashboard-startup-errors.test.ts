import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";

const dashboard=readFileSync(new URL("../prototypes/dashboard/index.html",import.meta.url),"utf8");
const evidence=readFileSync(new URL("../packages/client/index.html",import.meta.url),"utf8");

test("Codeworker without worktree gives complete supported startup commands",()=>{
  const a=dashboard.indexOf("function codeWorkbench(){");
  const b=dashboard.indexOf("const draft=codeDraft",a);
  assert.ok(a>=0&&b>a);
  const message=dashboard.slice(a,b);
  assert.match(message,/Werkmap|projectmap/);
  assert.match(message,/npm run local:ollama -- --example/);
  assert.match(message,/npm run local:ollama -- --worktree=\/pad\/naar\/jouw\/project/);
  assert.match(message,/Ctrl\+C/);
  assert.match(message,/START-HIER\.md/);
  assert.match(message,/Er wordt niets automatisch gewijzigd/);
});

test("separate evidence root offers a same-origin link to work dashboard",()=>{
  assert.match(evidence,/<a href="\/dashboard" class="act"/);
  assert.match(evidence,/Dit is de aparte bewijsomgeving/);
  assert.match(evidence,/tijdelijke token wordt bij opnieuw starten vernieuwd/);
  assert.match(evidence,/\^401\\b/);
  assert.match(evidence,/nieuwste link uit Terminal/);
  assert.doesNotMatch(evidence,/localStorage\.setItem/);
});

test("dashboard and evidence root preserve parseable client scripts",()=>{
  for(const [name,html] of [["dashboard",dashboard],["evidence",evidence]]){
    const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
    assert.ok(scripts.length, name+" script missing");
    for(const script of scripts)new Script(script,{filename:name});
  }
});

import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext,Script} from "node:vm";

const html=readFileSync(new URL("../prototypes/dashboard/index.html",import.meta.url),"utf8");
const guide=readFileSync(new URL("../docs/START-HIER.md",import.meta.url),"utf8");
const excerpt=(start:string,end:string)=>{
  const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a);
  return html.slice(a,b);
};

test("getting-started guide is linked, distinguishing demo and persistent Ollama mode",()=>{
  const readme=readFileSync(new URL("../README.md",import.meta.url),"utf8");
  const index=readFileSync(new URL("../docs/index.md",import.meta.url),"utf8");
  assert.match(readme,/docs\/START-HIER\.md/);
  assert.match(index,/START-HIER\.md/);
  assert.match(html,/top-help-link/);
  assert.match(html,/Startgids/);
  assert.match(guide,/npm run demo:dashboard/);
  assert.match(guide,/npm run local:ollama/);
  assert.match(guide,/Ctrl\+C/);
  assert.match(guide,/127\.0\.0\.1:8788/);
  assert.match(guide,/~\/\.eaiwork\/local/);
  assert.match(guide,/geen/gi);
});

test("local overview defaults to simple actions without removing the detailed workbench",()=>{
  const source=excerpt("function liveOverview(){","function localConnectView(){");
  const context={
    s:{liveOps:{missions:{},workers:{},history:[],defects:{}}},
    codePlans:[],codeConnections:{ollama:{status:"ready"},docker:{status:"ready"}},
    liveMissionProgress:()=>({done:0,total:1,failed:0,ready:1,blockedByConstraints:0,status:"Wacht"}),
    badge:(v:string)=>"<span>"+v+"</span>",
    readableCodeStep:()=>"",
    h:(v:unknown)=>String(v??""),
    btn:(label:string)=>"<button>"+label+"</button>",
    section:(title:string,body:string)=>"<section>"+title+body+"</section>",
    workerLastTask:()=>null,
    workerDisplayName:()=>"",
    workerPurpose:()=>"",
    workerStageText:()=>"",
  };
  const render=runInNewContext(source+"\nliveOverview",context);
  const output=render();
  assert.match(output,/Waar wil je aan werken\?/);
  assert.match(output,/Begin een opdracht/);
  assert.match(output,/Verder met je werk/);
  assert.match(output,/Jouw beslissing nodig/);
  assert.match(output,/Nieuwe codeopdracht/);
  assert.match(output,/<details[^>]*><summary>Uitgebreide overzichten en technische controles<\/summary>/);
  assert.match(output,/Mijn opdrachten/);
  assert.match(output,/Zelfstandig werken/);
  assert.match(output,/Ollama verbonden/);
  assert.ok(output.indexOf("Waar wil je aan werken?")<output.indexOf("<details"));
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
  for(const script of scripts)new Script(script);
});

test("unconnected local screen points to the terminal and a written guide",()=>{
  const source=excerpt("function localConnectView(){","function liveLogbook(){");
  assert.match(source,/npm run demo:dashboard/);
  assert.match(source,/npm run local:ollama/);
  assert.match(source,/START-HIER\.md/);
  assert.match(source,/Toegangstoken/);
});

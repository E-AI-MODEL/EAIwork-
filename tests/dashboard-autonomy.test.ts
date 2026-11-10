import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const html=readFileSync(new URL("../prototypes/dashboard/index.html",import.meta.url),"utf8");
const take=(start:string,end:string)=>{
  const i=html.indexOf(start),j=html.indexOf(end,i+start.length);
  assert.ok(i>=0&&j>i,"Missing dashboard function "+start);
  return html.slice(i,j);
};
test("autonomous execution is a first-class control, not hidden in technical details",()=>{
  const source=take("function realMissions(){","function orderedPlanPanel(){");
  const control=source.indexOf("automationPanel(selected)");
  const details=source.indexOf('<details class="card pad mt"><summary>Meer mogelijkheden en technische details');
  assert.ok(control>=0&&details>control,
    "users must see the automatic execution control before advanced technical details");
  assert.equal(source.slice(details).includes("automationPanel(selected)"),false,
    "automatic execution must not be available only inside advanced details");
});

test("automatic execution visibly requires consent and never claims autonomous code publication",()=>{
  const source=take("function automationPanel(m){","async function controlAutomation(id,action){");
  const render=runInNewContext(source+String.fromCharCode(10)+"automationPanel",{
    section:(name:string,body:string)=>"<section>"+name+body+"</section>",
    btn:(label:string,_action:string,_variant:string,attrs:string="")=>"<button "+attrs+">"+label+"</button>",
    h:(v:unknown)=>String(v??""),
    badge:(v:string)=>"<span>"+v+"</span>",
  });
  const base={
    plan:{id:"local-task",tasks:[{taskKind:"text-normalize",effect:"local"}]},
    tasks:{"task-a":{status:"queued"}},paused:false,
  };
  const manual=render(base);
  assert.match(manual,/Automatisch verdergaan/);
  assert.match(manual,/Start automatisch/);
  assert.match(manual,/automaticConsent/);
  assert.match(manual,/automaticLimit/);
  assert.match(manual,/codewijzigingen en publicatie/i);
  const running=render({...base,automation:{
    enabled:true,approvedBy:"person:owner",starts:1,maxStarts:4
  }});
  assert.match(running,/Stop automatisch werken/);
  assert.match(running,/1 \/ 4/);
  assert.doesNotMatch(running,/Start automatisch/);
  const unsafe=render({...base,plan:{
    id:"unsafe",tasks:[{taskKind:"repo-search",effect:"external-write"}]
  }});
  assert.match(unsafe,/Automatisch starten is hier uitgeschakeld/);
  assert.match(unsafe,/<button disabled>Start automatisch<\/button>/);
});

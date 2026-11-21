/**
 * Quiet, first-step browser UI. Text is added using textContent, never as HTML.
 * A protected Cloudflare session is mandatory before this asset is served.
 */
export const html=String.raw`<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EAIwork · Besloten werkruimte</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#263530;background:#f7f8f6}
*{box-sizing:border-box}body{margin:0}button,input,textarea{font:inherit}
header{border-bottom:1px solid #e0e6e0;background:#fff}.head{max-width:970px;margin:auto;padding:17px 24px;display:flex;gap:20px;align-items:center;justify-content:space-between}
.brand{font-size:17px;font-weight:730;letter-spacing:-.03em}.brand small{font-size:11px;color:#73827a;font-weight:450;margin-left:12px}
.tag{font-size:10px;color:#667b70;border:1px solid #cedbd3;border-radius:20px;padding:5px 10px}
main{max-width:970px;margin:0 auto;padding:30px 24px 85px}h1{font-size:clamp(25px,4vw,37px);line-height:1.17;letter-spacing:-.045em;margin:0 0 9px}h2{font-size:17px;letter-spacing:-.02em;margin:0}
.muted{color:#74837b;font-size:13px;line-height:1.65}.intro{margin-bottom:27px}.layout{display:grid;grid-template-columns:1.2fr 1fr;gap:18px;align-items:start}
.card{background:#fff;border:1px solid #dfe6df;border-radius:15px;padding:24px;box-shadow:0 5px 22px #243e2707}
input,textarea{display:block;width:100%;border:1px solid #d8e2d9;border-radius:9px;background:#fbfcfb;padding:10px 12px;font-size:13px;color:#263530;margin-top:6px}
textarea{resize:vertical;min-height:142px}label{display:block;font-size:12px;font-weight:650;margin-top:19px}
button{border:1px solid #c9d8cc;background:#fff;border-radius:9px;padding:10px 13px;color:#263530;font-size:12px;font-weight:650;cursor:pointer;min-height:38px}
button.primary{background:#2d5040;border-color:#2d5040;color:#fff}button:disabled{opacity:.45;cursor:default}button:hover:not(:disabled){filter:brightness(.97)}
.actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:16px}.item{border-top:1px solid #eef1eb;padding:16px 0}.item:first-child{border-top:none}.item h3{font-size:13px;margin:0 0 5px}.item p{margin:0}.status{font-size:11px;color:#698070}
pre{font-size:12px;padding:12px;border-radius:8px;border:1px solid #e5ece5;background:#f8faf8;white-space:pre-wrap;overflow-wrap:anywhere}
.warning{padding:10px 12px;border:1px solid #edceae;background:#fffaf1;border-radius:9px;color:#8b5b23;font-size:12px;margin-bottom:14px}
#message{min-height:20px;margin:12px 0;color:#315f49;font-size:12px}#message.error{color:#ad463a}
details{margin-top:18px;border-top:1px solid #e6ebe6;padding-top:15px}summary{font-size:12px;cursor:pointer;color:#64796d}
footer{margin-top:34px;border-top:1px solid #e0e6e0;padding-top:14px;color:#7d8d83;font-size:11px}
@media(max-width:750px){.layout{grid-template-columns:1fr}main{padding:22px 14px 55px}.head{padding:14px}.card{padding:18px}}
</style></head>
<body><header><div class="head"><div class="brand">EAIwork <small>mijn werkruimte</small></div><span class="tag">Besloten · Cloudflare</span></div></header>
<main><div class="intro"><h1>Waar wil je mee beginnen?</h1>
<p class="muted">De eerste online proef. Opdrachten en uitgevoerde controles worden bewaard. De Codeworker voor projectbestanden is nog niet online.</p></div>
<div class="layout"><section class="card"><h2>Nieuwe tekstinspectie</h2>
<p class="muted">EAIwork controleert eerst of er een geschikte worker beschikbaar is. Zo niet, dan kun je een geteste kandidaat laten samenstellen.</p>
<form id="create"><label for="title">Naam van de opdracht<input id="title" name="title" maxlength="160" value="Mijn eerste tekstcontrole" required></label>
<label for="source">Welke tekst wil je laten inspecteren?<textarea id="source" name="source" maxlength="12000" required placeholder="Plak hier een korte testtekst. Gebruik nog geen vertrouwelijke gegevens."></textarea></label>
<div class="actions"><button type="submit" class="primary">Opdracht toevoegen</button></div></form>
<div id="message" role="status" aria-live="polite"></div>
<details><summary>Wat kan deze proef precies?</summary><p class="muted">De Builder kan alleen de vaste tekstbewerking en teksttelling samenstellen. Daarna worden drie vaste tests uitgevoerd. Jij geeft de worker apart vrij en start de taak. Codegeneratie, externe acties en automatische publicatie zijn niet beschikbaar.</p></details>
</section><section class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2>Mijn opdrachten</h2><button id="refresh">Ververs</button></div>
<div id="tasks"><p class="muted">Bezig met het ophalen van je opdrachten...</p></div>
<div id="worker"></div>
</section></div>
<footer>Technische afronding is geen onafhankelijk bewijs van inhoudelijke juistheid. Alleen jouw beveiligde Cloudflare-sessie geeft toegang tot deze gegevens.</footer></main>
<script src="/app.js" defer></script></body></html>`;

export const javascript=String.raw`"use strict";
const $=(id)=>document.getElementById(id);
const tasks=$("tasks"),worker=$("worker"),message=$("message");
let busy=false;
const el=(tag,txt,cls)=>{const node=document.createElement(tag);if(txt!==undefined)node.textContent=String(txt);if(cls)node.className=cls;return node};
function note(txt,isError=false){message.textContent=txt;message.className=isError?"error":""}
async function request(path,action){
 const r=await fetch(path,{method:action?"POST":"GET",credentials:"same-origin",
   headers:action?{"Content-Type":"application/json"}:{},
   ...(action?{body:JSON.stringify(action)}:{})});
 const data=await r.json().catch(()=>({error:"Ongeldige serverreactie"}));
 if(!r.ok)throw Error(data.error||"Serverfout ("+r.status+")");
 return data;
}
function actionButton(label,command,missionId,primary=false){
 const b=el("button",label,primary?"primary":"");
 b.disabled=busy;
 b.addEventListener("click",async()=>{
   if(busy)return;
   if(command==="release"&&!confirm("Deze vaste, geteste worker voor deze opdracht vrijgeven?"))return;
   busy=true;note("Bezig...");renderLast();
   try{const data=await request("/api/action",{type:command,missionId});
     note(command==="prepare"?"Kandidaat getest. Vrijgave is nog nodig.":
       command==="release"?"Worker vrijgegeven. Je kunt de opdracht nu starten.":
       "Taak uitgevoerd. Het resultaat is nog niet onafhankelijk beoordeeld.");
     render(data.state);
   }catch(e){note(String(e.message||e),true)}
   finally{busy=false;await refresh(true)}
 });
 return b;
}
let last=null;
function renderLast(){if(last)render(last)}
function render(data){
 last=data;tasks.replaceChildren();worker.replaceChildren();
 const w=data.worker;
 if(w){
   const p=el("p","Worker: "+w.id+" · "+(w.stage==="ready"?"Vrijgegeven":"Kandidaat"),"muted");
   worker.append(p);
 }
 if(!data.missions.length){
   tasks.append(el("p","Nog geen opdrachten. Begin links met een korte tekst.","muted"));return;
 }
 for(const mission of data.missions){
   const container=el("article",undefined,"item"),heading=el("h3",mission.title);
   const states={queued:"Wacht op worker of start",running:"Wordt uitgevoerd",
     done:"Afgerond",failed:"Mislukt"};
   const p=el("p",states[mission.status]||mission.status,"status");
   container.append(heading,p);
   if(mission.output){
     const pre=el("pre",JSON.stringify(mission.output,null,2));
     container.append(pre);
     container.append(el("p","Uitvoering voltooid · inhoudelijke beoordeling nog niet uitgevoerd","muted"));
   }else if(mission.status==="queued"){
     const act=el("div",undefined,"actions");
     if(!w)act.append(actionButton("Worker bouwen en testen","prepare",mission.id,true));
     else if(w.stage==="candidate")act.append(actionButton("Geteste worker vrijgeven","release",mission.id,true));
     else if(w.stage==="ready")act.append(actionButton("Tekstinspectie starten","run",mission.id,true));
     else act.append(el("p","Worker is niet beschikbaar. Controle nodig.","muted"));
     container.append(act);
   }
   tasks.append(container);
 }
}
async function refresh(silent=false){
 try{const data=await request("/api/state");render(data);
   if(!silent)note("");
 }catch(e){note(String(e.message||e),true)}
}
$("refresh").addEventListener("click",()=>refresh());
$("create").addEventListener("submit",async ev=>{
 ev.preventDefault();if(busy)return;
 busy=true;note("Opdracht vastleggen...");
 try{const data=await request("/api/action",{
   type:"create",title:$("title").value,text:$("source").value
 });render(data.state);$("source").value="";note("Opdracht toegevoegd.");}
 catch(e){note(String(e.message||e),true)}
 finally{busy=false}
});
refresh();
`;

/** Accessible private workspace. User text is displayed with textContent only. */
export const html=String.raw`<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EAIwork · Mijn werkruimte</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#22362f;background:#f5f7f5}
*{box-sizing:border-box}body{margin:0}button,input,textarea{font:inherit}button:focus-visible,textarea:focus-visible{outline:2px solid #256950;outline-offset:2px}
header{border-bottom:1px solid #dce4de;background:#fff}.head{max-width:1320px;padding:0 26px;margin:auto;min-height:65px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.brand{font-size:16px;font-weight:760;letter-spacing:-.035em}.brand small{font-size:11px;color:#819187;font-weight:460;margin-left:13px}
.tag{font-size:10px;color:#537061;border:1px solid #d2ded6;border-radius:18px;padding:5px 10px}
main{max-width:1320px;margin:auto;padding:24px 26px 28px}.intro{display:flex;justify-content:space-between;gap:16px;align-items:end;margin-bottom:20px}
h1{font-size:clamp(22px,3vw,30px);letter-spacing:-.043em;margin:0 0 5px;line-height:1.12}h2{font-size:13px;font-weight:740;letter-spacing:-.01em;margin:0}
.muted{font-size:12px;line-height:1.65;color:#75857c}.intro p{margin:0}.layout{display:grid;grid-template-columns:minmax(300px,.95fr) minmax(420px,1.3fr);gap:14px;align-items:stretch}
.panel{min-width:0;background:#fff;border:1px solid #dae4dd;border-radius:14px;overflow:hidden;box-shadow:0 5px 20px #1c3d2905}
.panel-header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:18px 20px;border-bottom:1px solid #ebf0ec}
.panel-body{padding:20px}.lead{font-size:13px;color:#546d5d;line-height:1.65;margin:0 0 16px}
label{display:block;color:#4b6758;font-size:11px;font-weight:670;margin:0 0 8px}
textarea{display:block;width:100%;border:1px solid #d7e3d9;border-radius:9px;padding:13px;background:#fbfcfb;color:#243c30;font-size:13px;line-height:1.6;resize:vertical;min-height:148px}
textarea::placeholder{color:#91a296}#source{min-height:122px;margin-top:12px}
.runtime-picker{border:0;margin:13px 0 0;padding:0;min-width:0}
.runtime-picker legend{font-size:11px;font-weight:700;color:#506a59;margin-bottom:8px}
.runtime-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
.runtime-options label{display:flex;align-items:center;justify-content:center;position:relative;cursor:pointer;border:1px solid #d6e2d9;background:#fff;border-radius:8px;padding:10px 5px;font-size:12px;font-weight:570;text-align:center;margin:0}
.runtime-options input{position:absolute;opacity:0;width:1px;height:1px}
.runtime-options label:has(input:checked){background:#eaf3ec;border-color:#72a082;color:#26543b;font-weight:750}
.runtime-options label:has(input:focus-visible){outline:2px solid #256950;outline-offset:2px}
.runtime-note{margin:8px 0 0;font-size:11px;color:#718579;line-height:1.55}
button{border:1px solid #cbdccf;border-radius:8px;background:#fff;color:#264535;padding:9px 13px;cursor:pointer;font-weight:650;font-size:12px;min-height:35px;transition:background .18s}
button:hover:not(:disabled){background:#f2f7f3}button:disabled{opacity:.5;cursor:not-allowed}
button.primary{background:#27553d;border-color:#27553d;color:#fff}button.primary:hover:not(:disabled){background:#1e4832}
.hint{font-size:11px;color:#87968b;margin:10px 0 0;line-height:1.6}details{margin-top:16px;border-top:1px solid #edf1ee;padding-top:12px}
summary{color:#496d56;font-size:12px;cursor:pointer;line-height:1.6}
.form-actions{display:flex;justify-content:space-between;align-items:center;gap:15px;margin-top:17px;flex-wrap:wrap}
#message{font-size:12px;color:#2f7251;min-height:22px;line-height:1.55;margin:14px 0 0}#message.error{color:#a4443a}
.work-area{display:grid;grid-template-columns:minmax(172px,.72fr) minmax(265px,1.28fr);min-height:465px}
.mission-list{overflow:auto;max-height:620px;border-right:1px solid #e9eeea}
.mission-option{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #eef2ee;border-radius:0;padding:14px 15px;min-height:64px;font-size:12px;color:#344c3b;font-weight:580;background:#fff}
.mission-option:hover:not(:disabled){background:#f5f8f5}.mission-option.selected{background:#f0f6f1;box-shadow:inset 2px 0 0 #47785a}
.mission-option strong{font-size:12px;font-weight:700;display:block;line-height:1.45;overflow-wrap:anywhere}
.status{display:block;margin-top:5px;font-size:10px;font-weight:520;color:#7c8f80;line-height:1.4}
.detail{padding:20px 22px;min-width:0;overflow:auto;max-height:620px}
.detail h3{font-size:16px;line-height:1.4;letter-spacing:-.02em;margin:0 0 8px;overflow-wrap:anywhere}
.stage{font-size:11px;color:#567861;margin-bottom:16px}
.detail-section{padding-top:14px;border-top:1px solid #e8ede9;margin-top:14px}
.detail-section p{font-size:12px;line-height:1.65;margin:8px 0 0;color:#4f6255;overflow-wrap:anywhere;white-space:pre-wrap}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:12px 0}
.metric{border:1px solid #e1e9e3;border-radius:9px;padding:12px 9px}.metric strong{font-size:21px;font-weight:650;letter-spacing:-.035em;display:block}.metric span{font-size:10px;color:#7d9184}
pre{background:#f7faf7;border:1px solid #e3eae4;padding:12px;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;max-height:220px;overflow:auto}
.worker{border-top:1px solid #e8eee9;padding:11px 20px;font-size:11px;color:#6c8575}
a.artifact-link{display:inline-block;text-decoration:none;border:1px solid #c8dacd;border-radius:8px;padding:10px 13px;font-weight:650;font-size:12px;color:#24563a;background:#f5faf6}a.artifact-link:hover{background:#eaf2eb}
.tiny-bar{display:grid;grid-template-columns:minmax(78px,110px) 1fr 45px;align-items:center;gap:6px;padding:6px 0;font-size:11px}.tiny-bar-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tiny-bar-track{height:9px;background:#e8f0e9;border-radius:3px;overflow:hidden}.tiny-bar-fill{height:100%;background:#4c8362}.tiny-bar-number{text-align:right;font-variant-numeric:tabular-nums}
#example-csv{font-size:11px;color:#335f43;margin-top:9px}
#csv-file{font-size:11px;padding:8px 0;max-width:100%;color:#53765c}
.back-to-list{display:none}
.mobile-nav{display:none}
#work-message{padding:0 17px;font-size:11px;color:#2c6a4c}
#work-message.error{color:#a4443a}
#work-message:not(:empty){padding-top:9px;padding-bottom:9px;border-bottom:1px solid #edf1ed}
.mission-option strong{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.mission-list .muted{padding:15px}
.detail .detail-section:first-of-type{margin-top:10px}
footer{margin:18px 0 0;padding-top:13px;border-top:1px solid #e3e9e4;font-size:11px;color:#88978a;line-height:1.6}
@media(max-width:830px){
html,body{height:100%;overscroll-behavior:none}
body{height:100dvh;display:flex;flex-direction:column;overflow:hidden}
header{flex:none}
.head{min-height:49px;padding:0 16px}
.brand{font-size:14px}.brand small{font-size:10px;margin-left:7px}
.tag{font-size:9px;padding:4px 7px}
main{width:100%;max-width:none;flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;padding:0}
.intro{flex:none;display:block;padding:12px 16px 9px;margin:0}
.intro h1{font-size:20px;margin:0;line-height:1.2}
.intro .muted{display:none}
.mobile-nav{display:grid;grid-template-columns:1fr 1fr;gap:6px;flex:none;padding:5px 12px 8px;border-bottom:1px solid #e3ebe5}
.mobile-tab{min-height:40px;padding:8px 9px;font-size:12px;border:0;background:transparent;color:#708277}
.mobile-tab[aria-pressed="true"]{background:#e6f0e9;color:#255138}
.layout{display:block;flex:1;min-height:0;overflow:hidden}
.layout[data-mobile-view="create"] #work-panel{display:none}
.layout[data-mobile-view="work"] #create-panel{display:none}
.panel{height:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:none;border:0;border-radius:0}
.panel-header{padding:10px 16px;flex:none;min-height:46px}
.panel-header .tag{display:none}
.panel-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:16px}
.panel-body .lead{display:none}
textarea{min-height:100px;max-height:40dvh;resize:vertical;font-size:16px}
#source{min-height:115px}
label{margin:0 0 7px}
.form-actions{margin-top:13px;gap:8px}
.form-actions .hint{font-size:10px}
#message{margin:10px 0 0}
.work-area{display:flex;flex:1;flex-direction:column;min-height:0;overflow:hidden}
.work-area[data-pane="detail"] .mission-list{display:none}
.work-area[data-pane="list"] .detail{display:none}
.mission-list{flex:1;min-height:0;max-height:none;overflow-y:auto;border-right:0;overscroll-behavior:contain}
.detail{flex:1;min-height:0;max-height:none;overflow-y:auto;overscroll-behavior:contain;padding:18px}
.back-to-list{display:inline-flex;align-items:center;margin:0 0 14px}
.mission-option{min-height:60px;padding:12px 16px}
.worker{flex:none;padding:9px 16px;font-size:10px}
footer{display:none}
}
@media(max-width:490px){
.detail h3{font-size:15px}
.metrics{gap:5px}
}
</style></head>
<body><header><div class="head"><div class="brand">EAIwork <small>mijn werkruimte</small></div><span class="tag">Besloten · Cloudflare Access</span></div></header>
<main><div class="intro"><div><h1>Wat wil je gedaan krijgen?</h1><p class="muted">Eén opdracht. EAIwork controleert welke worker die kan uitvoeren.</p></div></div>
<nav class="mobile-nav" aria-label="Werkruimte"><button class="mobile-tab" id="tab-create" type="button" aria-pressed="false" aria-controls="create-panel">Nieuwe opdracht</button><button class="mobile-tab" id="tab-work" type="button" aria-pressed="true" aria-controls="work-panel">Mijn werk</button></nav>
<div id="layout" class="layout" data-mobile-view="work">
<section id="create-panel" class="panel"><div class="panel-header"><h2>Nieuwe opdracht</h2><span class="tag">Gewone taal</span></div>
<div class="panel-body"><p class="lead">Beschrijf wat je wilt bereiken. Het systeem registreert ook opdrachten die de huidige cloudversie nog niet kan uitvoeren, zonder ze als afgerond te markeren.</p>
<form id="create"><label for="instruction">Wat wil je dat EAIwork doet?</label>
<textarea id="instruction" maxlength="1500" required placeholder="Bijvoorbeeld: Tel de woorden, tekens en regels in mijn tekst. Of: Bouw een dashboard voor mijn gegevens."></textarea>
<p class="hint" id="privacy-hint">Gebruik voorlopig alleen onschuldige testgegevens.</p>
<button type="button" id="example-csv">Vul een CSV-dashboardvoorbeeld in</button>
<details id="source-details"><summary>Tekst of gegevens toevoegen</summary><label for="source" class="hint">Alleen onschuldige testgegevens. Voor tekstinspectie is brontekst vereist.</label>
<input id="csv-file" type="file" accept=".csv,text/csv,text/plain" aria-label="Lees een CSV-bestand van dit apparaat">
<textarea id="source" maxlength="10000" placeholder="Bijvoorbeeld: Afdeling;Waarde en op nieuwe regels Noord;12, Zuid;18."></textarea></details>
<fieldset class="runtime-picker"><legend>Uitvoeren via</legend>
<div class="runtime-options">
<label><input type="radio" name="exec-location" value="auto" checked>Automatisch</label>
<label><input type="radio" name="exec-location" value="local">Lokaal</label>
<label><input type="radio" name="exec-location" value="cloud">Cloud</label>
</div><p id="runtime-note" class="runtime-note">EAIwork gebruikt alleen beschikbare, toegestane uitvoerders. Momenteel zijn alleen de cloudtekstworker en de vaste CSV-dashboardtemplate beschikbaar.</p></fieldset>
<div class="form-actions"><button type="submit" class="primary" id="submit">Opdracht vastleggen</button>
<span class="hint">Nieuwe workers worden niet zonder jouw toestemming vrijgegeven.</span></div></form>
<div id="message" role="status" aria-live="polite"></div>
<details><summary>Wat kan EAIwork nu online?</summary>
<p class="muted">De tekstworker telt en normaliseert tekst. De geteste CSV-dashboardtemplate kan met proefgegevens een zelfstandig HTML-dashboard bouwen, met filter, zoeken, tabel en grafiek. Beide gebruiken de bestaande Builder en menselijke vrijgave. De algemene Codeworker, echte Excelbestanden, willekeurige software en publicatie zijn nog niet aangesloten. EAIwork meldt dat als uitvoerblokkade, niet als voltooiing.</p></details>
</div></section>
<section id="work-panel" class="panel"><div class="panel-header"><h2>Mijn werk</h2><button id="refresh" type="button">Ververs</button></div>
<div id="work-message" role="status" aria-live="polite"></div><div id="workarea" class="work-area" data-pane="list"><nav id="tasks" class="mission-list" aria-label="Opdrachten"><p class="muted">Opdrachten ophalen...</p></nav>
<div id="detail" class="detail" aria-live="polite"><p class="muted">Selecteer een opdracht voor voortgang en resultaat.</p></div></div>
<div id="worker" class="worker"></div>
</section>
</div><footer>‘Afgerond’ betekent dat de technische bewerking is uitgevoerd. Inhoudelijke juistheid en het resultaat van een niet-ondersteunde opdracht zijn daarmee niet vastgesteld. Gebruik geen vertrouwelijke gegevens in deze proef.</footer>
</main><script src="/app.js" defer></script></body></html>`;

export const javascript=String.raw`"use strict";
const $=id=>document.getElementById(id);
const tasks=$("tasks"),detail=$("detail"),worker=$("worker"),message=$("message");
let busy=false,last=null,selectedId=null,mobilePane="list",mobileView="work";
function showMobile(view){
  mobileView=view;
  $("layout").dataset.mobileView=view;
  $("tab-create").setAttribute("aria-pressed",String(view==="create"));
  $("tab-work").setAttribute("aria-pressed",String(view==="work"));
}
const el=(tag,txt,cls)=>{const e=document.createElement(tag);if(txt!==undefined)e.textContent=String(txt);if(cls)e.className=cls;return e};
function note(txt,error=false){
  message.textContent=txt;message.className=error?"error":"";
  $("work-message").textContent=txt;
  $("work-message").className=error?"error":"";
}
async function request(path,action){
  const r=await fetch(path,{method:action?"POST":"GET",credentials:"same-origin",
    headers:action?{"Content-Type":"application/json"}:{},
    ...(action?{body:JSON.stringify(action)}:{})});
  const d=await r.json().catch(()=>({error:"Ongeldige serverreactie"}));
  if(!r.ok)throw Error(d.error||"Serverfout ("+r.status+")");
  return d;
}
function status(m){
  if(m.status==="done")return "Technisch afgerond";
  if(m.status==="failed")return "Uitvoering mislukt";
  if(m.csvMissing)return "CSV-gegevens ontbreken";
  if(m.sourceMissing||m.need?.status==="source-required")return "Brontekst ontbreekt";
  if(m.execution?.status==="site-unavailable")return m.execution.requested==="local"?
    "Lokale uitvoerder niet gekoppeld":"Cloud-uitvoerder niet gekoppeld";
  if(m.execution?.status==="worker-unavailable"&&
     m.execution.requested==="local")return "Lokaal geen geschikte worker";
  if(m.need?.status==="unsupported")return "Geen geschikte worker";
  if(m.need?.status==="condition-blocked")return "Wacht op beoordeling";
  if(m.need?.status==="buildable")return "Worker ontbreekt";
  if(m.need?.status==="awaiting-release")return "Wacht op jouw vrijgave";
  if(m.need?.status==="available")return "Klaar voor uitvoering";
  return "Wacht op controle";
}
function button(label,command,missionId){
  const b=el("button",label,"primary");b.disabled=busy;
  b.addEventListener("click",async()=>{
    if(busy)return;
    if(command==="release"&&!confirm("Deze geteste worker vrijgeven voor tekstinspectie?"))return;
    busy=true;note("Bezig...");render(last);
    try{const d=await request("/api/action",{type:command,missionId});
      render(d.state);note(command==="prepare"?"Worker getest. Je vrijgave is nog nodig.":command==="release"?"Worker vrijgegeven.":"Bewerking uitgevoerd; inhoudelijke beoordeling ontbreekt.");
    }catch(e){note(String(e.message||e),true)}
    finally{busy=false;await refresh(true)}
  });
  return b;
}
function dashboardResult(m,o){
  const h=el("div",undefined,"detail-section");
  h.append(el("h2","Gebouwd: interactieve CSV-dashboardtemplate"));
  const grid=el("div",undefined,"metrics");
  for(const [value,label] of [[o.rowCount,"Rijen"],[o.columns?.length??0,"Kolommen"],["HTML","Bestand"]]){
    const k=el("div",undefined,"metric");
    k.append(el("strong",value),el("span",label));grid.append(k);
  }
  h.append(grid);
  const preview=el("div",undefined,"detail-section");
  preview.append(el("h2","Voorbeeld van de grafiek"));
  const totals=new Map(),cat=o.categoryColumn,metric=o.numericColumn;
  for(const row of o.rows||[]){
    const key=String(row[cat]||"Onbekend");
    const raw=metric===null?null:String(row[metric]||"").trim().replace(",",".");
    const n=raw!==null&&raw&&Number.isFinite(Number(raw))?Number(raw):0;
    totals.set(key,(totals.get(key)||0)+(metric===null?1:n));
  }
  const bars=[...totals].sort((a,b)=>b[1]-a[1]).slice(0,6);
  const max=Math.max(1,...bars.map(x=>Math.abs(x[1])));
  for(const [name,value] of bars){
    const line=el("div",undefined,"tiny-bar");
    line.append(el("span",name,"tiny-bar-name"));
    const track=el("div",undefined,"tiny-bar-track");
    const fill=el("div",undefined,"tiny-bar-fill");
    fill.style.width=Math.min(100,Math.abs(value)/max*100)+"%";
    track.append(fill);line.append(track);
    line.append(el("span",new Intl.NumberFormat("nl-NL",{maximumFractionDigits:1}).format(value),"tiny-bar-number"));
    preview.append(line);
  }
  h.append(preview);
  const actions=el("div",undefined,"actions");
  for(const [label,mode] of [["Open interactief voorbeeld","preview"],["Download HTML","download"]]){
    const a=el("a",label,"artifact-link");
    a.href="/api/artifact?missionId="+encodeURIComponent(m.id)+"&mode="+mode;
    if(mode==="preview"){a.target="_blank";a.rel="noopener noreferrer";}
    else a.download="eaiwork-dashboard.html";
    actions.append(a);
  }
  h.append(actions);
  h.append(el("p","Vaste HTML-template op basis van je CSV. Geen algemene codegeneratie, publicatie of onafhankelijke inhoudelijke beoordeling.","muted"));
  const more=el("details");more.append(el("summary","Technische uitvoergegevens"));
  more.append(el("pre",JSON.stringify({version:o.kind,artifactSha256:o.artifactSha256,
    rowCount:o.rowCount,columns:o.columns,verification:m.verification},null,2)));
  h.append(more);detail.append(h);
}
function result(m){
  const o=m.output;
  if(!o||typeof o!=="object")return;
  if(o.kind==="csv-dashboard-v1"){dashboardResult(m,o);return;}
  const h=el("div",undefined,"detail-section");h.append(el("h2","Resultaat van de tekstinspectie"));
  const grid=el("div",undefined,"metrics");
  for(const [k,label] of [["words","Woorden"],["characters","Tekens"],["lines","Regels"]]){
    if(typeof o[k]!=="number")continue;
    const metric=el("div",undefined,"metric");
    metric.append(el("strong",o[k]),el("span",label));grid.append(metric);
  }
  h.append(grid);
  if(typeof o.changed==="boolean")h.append(el("p",o.changed?"De tekst is genormaliseerd.":"De tekst is ongewijzigd."));
  const d=el("details");d.append(el("summary","Uitvoergegevens bekijken"));
  d.append(el("pre",JSON.stringify(o,null,2)));h.append(d);
  h.append(el("p","Technisch uitgevoerd. Niet onafhankelijk inhoudelijk beoordeeld."));
  detail.append(h);
}
function requestSource(m){
  showMobile("create");
  $("instruction").value=m.requestedOutcome||m.title;
  $("source-details").open=true;
  $("source").focus();
  note(m.csvMissing?"Plak CSV met een kolomrij en minstens één gegevensrij.":"Voeg de brontekst toe. De eerdere onvolledige opdracht blijft bewaard.");
}
function showDetails(m,w){
  detail.replaceChildren();
  const back=el("button","Terug naar opdrachten","back-to-list");
  back.type="button";
  back.addEventListener("click",()=>{
    mobilePane="list";render(last);
    $("workarea").scrollTop=0;
  });
  detail.append(back);
  if(!m){detail.append(el("p","Selecteer een opdracht voor voortgang en resultaat.","muted"));return}
  detail.append(el("h3",m.title),el("span",status(m),"stage"));
  const loc=el("p","Uitvoering: "+(
    m.execution?.site==="cloud"?"Cloud":
    m.execution?.site==="local"?"Lokaal":m.execution?.requested==="local"?"Lokaal, niet gekoppeld":
    m.execution?.requested==="cloud"?"Cloud, geen adapter":"Automatisch, geen geschikte uitvoerder"
  ),"muted");
  detail.append(loc);
  if(m.status==="queued"&&m.execution){
    const placement=el("section",undefined,"detail-section");
    const heading=el("h2","Uitvoerplek wijzigen");
    placement.append(heading);
    const form=el("fieldset",undefined,"runtime-picker");
    const choices=el("div",undefined,"runtime-options");
    const choiceName="site-"+m.id;
    const buttons=[];
    for(const [value,label] of [["auto","Automatisch"],["local","Lokaal"],["cloud","Cloud"]]){
      const wrap=el("label",undefined);
      const input=el("input");input.type="radio";input.name=choiceName;input.value=value;
      input.checked=m.execution.requested===value;
      wrap.append(input,document.createTextNode(label));choices.append(wrap);buttons.push(input);
    }
    const save=el("button","Uitvoerplek opslaan","primary");
    save.type="button";save.disabled=true;
    buttons.forEach(input=>input.addEventListener("change",()=>{
      save.disabled=busy||!buttons.some(i=>i.checked&&i.value!==m.execution.requested);
    }));
    save.addEventListener("click",async()=>{
      if(busy)return;
      const wanted=buttons.find(i=>i.checked)?.value;
      if(!wanted||wanted===m.execution.requested)return;
      busy=true;save.disabled=true;note("Uitvoerplek aanpassen...");
      try{
        const d=await request("/api/action",{type:"route",missionId:m.id,
          expectedRevision:m.revision,executionPreference:wanted});
        render(d.state);
        note("Keuze bewaard. Een uitvoerder wordt hierdoor nog niet gestart.");
      }catch(e){note(String(e.message||e),true)}
      finally{busy=false;await refresh(true)}
    });
    form.append(choices);placement.append(form,save);
    detail.append(placement);
  }
  if(m.requestedOutcome&&m.requestedOutcome!==m.title){
    const req=el("section",undefined,"detail-section");
    req.append(el("h2","Jouw opdracht"),el("p",m.requestedOutcome));detail.append(req);
  }
  if(m.status==="done"){result(m);return}
  const next=el("section",undefined,"detail-section");next.append(el("h2","Uitvoering"));
  if(m.sourceMissing||m.csvMissing||m.need?.status==="source-required"){
    next.append(el("p",m.csvMissing?
      "De oorspronkelijke opdracht bevatte geen CSV-data. Plak kolomnamen en proefrijen om een geteste HTML-dashboardtemplate te maken. Echte .xlsx-bestanden kan deze proef nog niet openen.":
      "De opdracht is bewaard, maar de te onderzoeken tekst ontbreekt. Voeg de brontekst toe om een nieuwe, uitvoerbare controle te starten."));
    const actions=el("div",undefined,"actions");
    const b=el("button",m.csvMissing?"CSV toevoegen":"Brontekst toevoegen","primary");
    b.type="button";b.addEventListener("click",()=>requestSource(m));actions.append(b);next.append(actions);
  }else if(m.execution?.site===null){
    next.append(el("p",(m.execution.reason||"Geen veilige uitvoeromgeving beschikbaar.")+
      " De opdracht blijft bewaard. Er is geen lokale taak gestart, geen cloudcode uitgevoerd en niets gepubliceerd."));
  }else if(m.need?.status==="unsupported"){
    next.append(el("p","De opdracht is bewaard, maar deze cloudversie kan dit soort werk nog niet uitvoeren. Er is geen geschikte uitvoerbare Codeworker of geteste Builder-receptuur. Er is niets gebouwd of gepubliceerd."));
  }else{
    next.append(el("p",m.need?.reason||"Wacht op de volgende uitvoeringsstap."));
    if(["text-inspect","csv-dashboard"].includes(m.taskKind)&&m.execution?.site==="cloud"){
      const actions=el("div",undefined,"actions");
      const selected=m.taskKind==="csv-dashboard"?last?.dashboardWorker:w;
      if(!selected)actions.append(button("Worker samenstellen en testen","prepare",m.id));
      else if(selected.stage==="candidate")actions.append(button("Geteste worker vrijgeven","release",m.id));
      else if(selected.stage==="ready")actions.append(button(
        m.taskKind==="csv-dashboard"?"HTML-dashboard bouwen":"Tekstinspectie uitvoeren","run",m.id));
      if(actions.childNodes.length)next.append(actions);
    }
  }
  detail.append(next);
}
function render(data){
  if(!data)return;
  last=data;tasks.replaceChildren();worker.replaceChildren();
  showMobile(mobileView);
  $("workarea").dataset.pane=mobilePane;
  const ms=data.missions||[],w=data.worker;
  if(!selectedId||!ms.some(m=>m.id===selectedId))selectedId=ms[0]?.id||null;
  if(!ms.length){tasks.append(el("p","Nog geen opdrachten.","muted"));showDetails(null,w)}
  else for(const m of ms){
    const b=el("button",undefined,"mission-option"+(m.id===selectedId?" selected":""));
    b.type="button";b.setAttribute("aria-current",m.id===selectedId?"true":"false");
    b.append(el("strong",m.title),el("span",status(m),"status"));
    b.addEventListener("click",()=>{
      selectedId=m.id;mobilePane="detail";render(last);
      showMobile("work");
      detail.scrollTop=0;
    });tasks.append(b);
  }
  if(ms.length)showDetails(ms.find(m=>m.id===selectedId),w);
  worker.textContent="Tekst: "+(w?.stage==="ready"?"vrijgegeven":"niet vrijgegeven")+
    " · CSV-dashboard: "+(data.dashboardWorker?.stage==="ready"?"vrijgegeven":
      data.dashboardWorker?.stage==="candidate"?"getest, vrijgave nodig":"niet vrijgegeven");
}
async function refresh(silent=false){
  try{const data=await request("/api/state");render(data);if(!silent)note("")}
  catch(e){note(String(e.message||e),true)}
}
function updateRuntimeNote(){
  const mode=document.querySelector('input[name="exec-location"]:checked')?.value||"auto";
  $("runtime-note").textContent=mode==="local"?
    "Lokaal is nog niet met deze browserwerkruimte verbonden. EAIwork bewaart de opdracht en start niets in de cloud.":
    mode==="cloud"?
    "De cloudtekstworker en de vaste CSV-dashboardtemplate kunnen werken. De algemene Codeworker is nog niet aangesloten.":
    "De cloudtekstworker en de vaste CSV-dashboardtemplate zijn mogelijk. EAIwork gebruikt alleen geteste, vrijgegeven workers.";
}
document.querySelectorAll('input[name="exec-location"]').forEach(input=>
  input.addEventListener("change",updateRuntimeNote));
updateRuntimeNote();
$("csv-file").addEventListener("change",async event=>{
  const file=event.target.files?.[0];
  if(!file)return;
  if(file.size>20000){
    note("CSV-bestand is te groot voor deze proef (maximaal 10.000 tekens).",true);
    event.target.value="";return;
  }
  try{
    const text=await file.text();
    if(!text.trim()||text.length>10000){
      note("CSV-bestand ontbreekt of is langer dan 10.000 tekens.",true);
      return;
    }
    $("source").value=text;
    $("source-details").open=true;
    if(!$("instruction").value.trim())
      $("instruction").value="Bouw een interactief dashboard van deze CSV-gegevens";
    note("CSV is ingelezen op je apparaat. Je kunt de gegevens controleren voordat je de opdracht vastlegt.");
  }catch{note("CSV-bestand kan niet worden gelezen.",true)}
  finally{event.target.value=""}
});
$("example-csv").addEventListener("click",()=>{
  $("instruction").value="Bouw een interactief dashboard van deze CSV-gegevens";
  $("source-details").open=true;
  $("source").value="Afdeling;Maand;Aantal\nNoord;Januari;12\nZuid;Januari;18\nWest;Januari;9\nNoord;Februari;16\nZuid;Februari;21\nWest;Februari;14";
  $("instruction").focus();
  note("Voorbeeld ingevuld. Kies Cloud of Automatisch en leg de opdracht vast.");
});
$("refresh").addEventListener("click",()=>refresh());
$("tab-create").addEventListener("click",()=>showMobile("create"));
$("tab-work").addEventListener("click",()=>{
  mobilePane="list";
  showMobile("work");
  render(last);
});
$("create").addEventListener("submit",async ev=>{
  ev.preventDefault();if(busy)return;
  busy=true;note("Opdracht vastleggen...");
  $("submit").disabled=true;
  try{
    const data=await request("/api/action",{type:"submit",
      instruction:$("instruction").value,sourceText:$("source").value,
      executionPreference:document.querySelector('input[name="exec-location"]:checked')?.value||"auto"});
    selectedId=data.result.missionId;
    mobilePane="detail";showMobile("work");render(data.state);
    $("instruction").value="";$("source").value="";
    note(data.result.stage==="unsupported"?
      "Opdracht opgeslagen. Er is nog geen passende Codeworker beschikbaar.":
      data.result.stage==="awaiting-executor"?
        "Opdracht opgeslagen. De gekozen uitvoeromgeving is nog niet aangesloten.":
      data.result.stage==="done"?
        data.result.taskKind==="csv-dashboard"?
          "HTML-dashboard samengesteld met de geteste template. Open het voorbeeld of download het bestand.":
          "Tekstinspectie uitgevoerd met de reeds vrijgegeven worker.":
        "Opdracht opgeslagen. Bekijk de volgende stap bij Mijn werk.");
  }catch(e){
    const msg=String(e.message||e);note(msg,true);
    if(msg.includes("brontekst")||msg.includes("CSV")){
      $("source-details").open=true;$("source").focus();
    }
  }
  finally{busy=false;$("submit").disabled=false}
});
showMobile("work");
refresh();`;

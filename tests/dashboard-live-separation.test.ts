import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const html=readFileSync(new URL("../prototypes/dashboard/index.html",import.meta.url),"utf8");
function take(start:string,end:string){
  const from=html.indexOf(start),to=html.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,"Missing dashboard section: "+start);
  return html.slice(from,to);
}
test("local startup never instantiates demo workers, tasks, missions or events",()=>{
  const expression=take("const init=()=>({","\nlet s=init()");
  const source=["missionSeed","workerSeed","taskSeed","hitlSeed","sourceSeed"]
    .map(key=>[key,[{id:"DEMO-ONLY"}]]);
  for(const demoMode of [false,true]){
    const result=runInNewContext(expression+"\ninit()",{
      demoMode,structuredClone,
      ...Object.fromEntries(source)
    });
    for(const key of ["missions","workers","tasks","hitl","sources"]){
      assert.equal(result[key].length,demoMode?1:0,key+" leaked into local startup");
    }
    if(!demoMode){
      assert.equal(result.events.length,0);
      assert.equal(result.selectedMission,null);
      assert.equal(result.selectedWorker,null);
      assert.equal(result.selectedTask,null);
    }else assert.ok(result.events.length>0);
  }
});
test("local menu omits all demo actions and demo-only pages",()=>{
  const declarations=take("const nav=","const worker=");
  const routes=take("const primaryRoutes=","function renderShell(){");
  const shell=take("function renderShell(){","function header(");
  function render(local:boolean){
    const slots:Record<string,{innerHTML?:string;textContent?:string}>={
      sidebar:{},topbar:{},footer:{}
    };
    const context={
      onExecutionServer:()=>local,
      s:{route:"overzicht",liveOps:null,selectedMission:null},
      mission:()=>null,
      ico:()=>"[icon]",
      btn:(txt:string)=>"<button>"+txt+"</button>",
      h:(value:string)=>String(value??""),
      document:{
        getElementById:(id:string)=>slots[id]??null,
        querySelector:()=>slots.footer
      }
    };
    runInNewContext(declarations+"\n"+routes+"\n"+shell+"\nrenderShell()",context);
    return slots;
  }
  const live=render(true);
  const localHtml=(live.sidebar.innerHTML||"")+(live.topbar.innerHTML||"");
  for(const forbidden of ["Opdrachten (demo)","Instellingen","Herstellen","Export","Simuleer ronde","Demonstratie"]){
    assert.doesNotMatch(localHtml,new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")),forbidden);
  }
  assert.match(localHtml,/Codeworker/);
  assert.match(localHtml,/Niet verbonden/);
  assert.match(live.footer.textContent||"",/lokale werkruimte/);
  const demo=render(false);
  const demoHtml=(demo.sidebar.innerHTML||"")+(demo.topbar.innerHTML||"");
  assert.match(demoHtml,/Opdrachten \(demo\)/);
  assert.match(demoHtml,/Herstellen/);
  assert.match(demoHtml,/Demonstratie/);
});
test("live router cannot show a demo screen before or after authentication",()=>{
  const src=take("function render(){","function renderModal(){");
  const names=["overview","missionView","realMissions","planner","workers","library",
    "registration","builder","codeWorkbench","quality","evidenceInspection","hitl",
    "sources","browserPage","logbook","settings","liveOverview","livePlanner",
    "liveWorkers","realQualityView","liveHumanQueue","liveRepoSearchPanel",
    "liveBuilderPanel","liveLogbook","localConnectView"];
  const output={innerHTML:""};
  let local=true,called="";
  const actions=Object.fromEntries(names.map(name=>[
    name,()=>{called=name;return "<main>"+name+"</main>";}
  ]));
  const context={
    ...actions,
    s:{route:"opdrachten",liveOps:null},
    onExecutionServer:()=>local,
    renderShell:()=>{},
    renderModal:()=>{},
    updateAutomationPolling:()=>{},
    header:()=>"",
    document:{getElementById:()=>output}
  };
  const run=runInNewContext(src+"\nrender",context);
  run();
  assert.equal(called,"localConnectView");
  context.s.liveOps={missions:{},workers:{},history:[]};
  for(const [route,expected] of [
    ["opdrachten","liveOverview"],["instellingen","liveOverview"],
    ["overzicht","liveOverview"],["workers","liveWorkers"],
    ["code","codeWorkbench"],["kwaliteit","realQualityView"]
  ]){
    context.s.route=route;
    run();
    assert.equal(called,expected,"Wrong local route "+route);
  }
  local=false;
  for(const [route,expected]of [
    ["opdrachten","missionView"],["instellingen","settings"],
    ["overzicht","overview"]
  ]){
    context.s.route=route;
    run();
    assert.equal(called,expected,"Demo route lost: "+route);
  }
});
test("local library does not fall back to the built-in demo catalog",()=>{
  const src=take("function library(){","function liveMissionProgress(");
  const context={
    onExecutionServer:()=>true,
    s:{liveCatalog:null,catalogGroup:"Alle",catalogSearch:"",selectedCatalog:null},
    catalogSeed:[{
      id:"DEMO-LIBRARY",name:"Fictieve worker",group:"plannen",
      taskKinds:["demo"],specialization:"Demo",suggestedModel:"none",
      requiredCapabilities:[],registryStage:"unregistered",version:null
    }],
    h:(s:unknown)=>String(s??""),
    btn:()=>"",
    badge:()=>"",
    section:(_title:string,value:string)=>value,
    header:()=>"",
  };
  const render=runInNewContext(src+"\nlibrary",context);
  const live=render();
  assert.doesNotMatch(live,/DEMO-LIBRARY/);
  assert.doesNotMatch(live,/Fictieve worker/);
  assert.match(live,/serverbibliotheek is nog niet geladen/);
});

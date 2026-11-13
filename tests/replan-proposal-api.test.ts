import {test} from "node:test";
import assert from "node:assert/strict";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "../scripts/local-demo.ts";
import type {PlanningModel} from "../packages/operations/src/planner.ts";

test("HTTP proposal remains read-only until owner applies the exact reviewed plan",async()=>{
  let proposals=0;
  const planner:PlanningModel={
    id:"mock:replan",
    async propose(){throw new Error("initial planning not used")},
    async proposeRevision(context){
      proposals++;
      assert.equal(context.currentRevision,1);
      assert.equal(context.existingTasks.length,1);
      return {
        addedTasks:[{id:"task-followup",title:"Woorden tellen",taskKind:"text-metrics",
          dependsOn:["task-first"],textFrom:"task-first"}],
        addedPhases:[{id:"phase-followup",title:"Controle",taskIds:["task-followup"]}],
        addedConstraints:[],
        missingInformation:["Wie beoordeelt de inhoud?"],
      };
    },
  };
  const demo=createDemoServer({schedulerIntervalMs:0,planningModel:planner});
  try{
    await new Promise<void>(resolve=>demo.server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
    const call=(method:string,path:string,payload?:unknown,token=demo.token)=>fetch(base+path,{
      method,headers:{Authorization:"Bearer "+token,...(payload?{"content-type":"application/json"}:{})},
      ...(payload?{body:JSON.stringify(payload)}:{}),
    });
    const plan={
      id:"mission-http-revision",title:"Tekstwerk",goal:"Eerst tekst opschonen, daarna controleren",
      sourceInstruction:"Werk de tekst bij en bewaar het resultaat.",
      tasks:[{id:"task-first",title:"Opschonen",taskKind:"text-normalize",dependsOn:[],
        input:{text:"  Hallo  wereld  "}}],
      phases:[{id:"phase-initial",title:"Voorbereiding",taskIds:["task-first"]}],
    };
    assert.equal((await call("POST","/ops/missions",{plan})).status,201);
    const url="/ops/missions/"+plan.id+"/replan/propose";
    assert.equal((await call("POST",url,{expectedRevision:1,reason:"Aanvullen"},"invalid")).status,401);
    assert.equal((await call("POST",url,{expectedRevision:0,reason:"Aanvullen"})).status,409);
    assert.equal((await call("POST",url,{expectedRevision:1,reason:"Aanvullen",approve:true})).status,422);
    assert.equal(proposals,0);
    const response=await call("POST",url,{expectedRevision:1,reason:"Controle toevoegen"});
    assert.equal(response.status,200);
    const candidate=await response.json() as any;
    assert.equal(candidate.status,"requires-human-review");
    assert.equal(candidate.expectedRevision,1);
    assert.equal(candidate.plan.tasks.length,2);
    assert.equal(candidate.preflight.canExecute,false);
    assert.equal(candidate.preflight.tasks[1].selectedWorkerId,"text-metrics");
    assert.equal(candidate.preflight.tasks[1].phaseId,"phase-followup");
    assert.deepEqual(candidate.missingInformation,["Wie beoordeelt de inhoud?"]);
    let current=await(await call("GET","/ops/missions")).json() as any;
    assert.equal(current.missions[plan.id].revision,1);
    assert.equal(current.missions[plan.id].tasks["task-followup"],undefined);
    assert.equal((await call("POST","/ops/missions/"+plan.id+"/extend",
      {expectedRevision:1,plan:candidate.plan})).status,201);
    assert.equal((await call("POST",url,{expectedRevision:1,reason:"Dezelfde revisie"})).status,409);
    assert.equal(proposals,1);
    const executed=await(await call("POST","/ops/missions/"+plan.id+"/run",{})).json() as any;
    assert.equal(executed.stopReason,"complete");
    current=await(await call("GET","/ops/missions")).json() as any;
    assert.equal(current.missions[plan.id].revision,2);
    assert.equal(current.missions[plan.id].tasks["task-followup"].run.output.words,2);
    assert.equal((await call("GET","/ops/verify")).status,200);
  }finally{await demo.close()}
});


test("a model proposal is discarded when the approved plan changes during its call",async()=>{
  let advancePlan:()=>Promise<void>=async()=>{};
  const planner:PlanningModel={
    id:"mock:stale",
    async propose(){throw new Error("not used")},
    async proposeRevision(){
      await advancePlan();
      return {addedTasks:[{id:"task-model",title:"Modeladvies",taskKind:"text-metrics",
        dependsOn:["task-source"],textFrom:"task-source"}],
        addedPhases:[{id:"phase-model",title:"Modelwerk",taskIds:["task-model"]}],
        addedConstraints:[],missingInformation:[]};
    },
  };
  const demo=createDemoServer({schedulerIntervalMs:0,planningModel:planner});
  try{
    await new Promise<void>(resolve=>demo.server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
    const call=(method:string,path:string,payload?:unknown)=>fetch(base+path,{
      method,headers:{Authorization:"Bearer "+demo.token,...(payload?{"content-type":"application/json"}:{})},
      ...(payload?{body:JSON.stringify(payload)}:{}),
    });
    const plan={
      id:"mission-stale-replan",title:"Revisietest",goal:"Voorkom oude voorstellen",
      sourceInstruction:"Maak een tekst.",
      tasks:[{id:"task-source",title:"Tekst maken",taskKind:"text-normalize",
        dependsOn:[],input:{text:"  tekst  "}}],
      phases:[{id:"phase-source",title:"Voorbereiden",taskIds:["task-source"]}],
    };
    assert.equal((await call("POST","/ops/missions",{plan})).status,201);
    advancePlan=async()=>{
      const newer={...plan,tasks:[...plan.tasks,{
        id:"task-human",title:"Controle door mens",taskKind:"text-metrics",
        dependsOn:["task-source"],textFrom:"task-source",
      }],phases:[...plan.phases,{id:"phase-human",title:"Extra fase",
        taskIds:["task-human"]}]};
      assert.equal((await call("POST","/ops/missions/"+plan.id+"/extend",
        {plan:newer,expectedRevision:1})).status,201);
    };
    const result=await call("POST","/ops/missions/"+plan.id+"/replan/propose",
      {expectedRevision:1,reason:"Overweeg extra taken"});
    assert.equal(result.status,409);
    const state=await(await call("GET","/ops/missions")).json() as any;
    assert.equal(state.missions[plan.id].revision,2);
    assert.ok(state.missions[plan.id].tasks["task-human"]);
    assert.equal(state.missions[plan.id].tasks["task-model"],undefined);
  }finally{await demo.close()}
});

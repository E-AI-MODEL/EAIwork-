import {test} from "node:test";
import assert from "node:assert/strict";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "../scripts/local-demo.ts";

const mission={
  id:"mission-auto-api",title:"Automatisch afwerken",goal:"Twee lokale tekststappen met menselijke toestemming",
  tasks:[
    {id:"task-clean",title:"Normaliseren",taskKind:"text-normalize",dependsOn:[],input:{text:"  Test  tekst "}},
    {id:"task-count",title:"Tellen",taskKind:"text-metrics",dependsOn:["task-clean"],textFrom:"task-clean"},
  ],
};
test("authorization, manual-run exclusion and bounded automation via HTTP",async()=>{
  const demo=createDemoServer({schedulerIntervalMs:0});
  try{
    await new Promise<void>(ok=>demo.server.listen(0,"127.0.0.1",ok));
    const base="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
    const call=async(method:string,path:string,payload?:unknown,token=demo.token)=>fetch(base+path,{
      method,headers:{Authorization:"Bearer "+token,...(payload?{"content-type":"application/json"}:{})},
      ...(payload?{body:JSON.stringify(payload)}:{}),
    });
    assert.equal((await call("POST","/ops/missions", {plan:mission})).status,201);
    const prefix="/ops/missions/"+mission.id+"/automation/";
    assert.equal((await call("POST",prefix+"start",{maxStarts:1},"invalid")).status,401);
    assert.equal((await call("POST",prefix+"start",{maxStarts:0})).status,422);
    assert.equal((await call("POST",prefix+"start",{maxStarts:33})).status,422);
    assert.equal((await call("POST",prefix+"start",{maxStarts:2,resumeAfterRestart:"yes"})).status,422);
    assert.equal((await call("POST",prefix+"start",{maxStarts:1,unsafe:true})).status,422);
    assert.equal((await call("POST","/ops/events",{type:"mission.automation.start",missionId:mission.id,maxStarts:32})).status,403);
    assert.equal((await call("POST","/ops/events",{type:"task.recover",
      missionId:mission.id,taskId:"task-clean",runId:"run-fake"})).status,403);
    assert.equal((await call("POST",prefix+"start",{maxStarts:1})).status,201);
    assert.equal((await call("POST",prefix+"start",{maxStarts:1})).status,422);
    assert.equal((await call("POST","/ops/missions/"+mission.id+"/run",{})).status,422);
    assert.equal((await call("POST","/ops/missions/"+mission.id+"/step",{})).status,422);
    assert.ok(demo.scheduler);
    assert.deepEqual(demo.scheduler.tick().stopped,[{missionId:mission.id,reason:"budget-exhausted"}]);
    let state=await(await call("GET","/ops/missions")).json() as any;
    assert.equal(state.missions[mission.id].automation.starts,1);
    assert.equal(state.missions[mission.id].automation.enabled,false);
    assert.equal(state.missions[mission.id].tasks["task-clean"].status,"done");
    assert.equal(state.missions[mission.id].tasks["task-count"].status,"queued");
    assert.equal((await call("POST",prefix+"start",{maxStarts:1})).status,201);
    assert.deepEqual(demo.scheduler.tick().stopped,[{missionId:mission.id,reason:"complete"}]);
    state=await(await call("GET","/ops/missions")).json() as any;
    assert.equal(state.missions[mission.id].tasks["task-count"].run.output.words,2);
    assert.equal(state.missions[mission.id].automation.stoppedReason,"complete");
    assert.equal((await call("POST",prefix+"stop",{})).status,422);
    assert.equal((await call("POST",prefix+"start",{maxStarts:1})).status,422);
    assert.equal((await call("POST","/ops/missions/mission-demo-repo/automation/start",{maxStarts:2})).status,422);
    assert.equal((await call("GET","/ops/verify")).status,200);
  }finally{await demo.close()}
});
test("timer continues approved local steps without repeated browser clicks",async()=>{
  const demo=createDemoServer({schedulerIntervalMs:25});
  try{
    await new Promise<void>(ok=>demo.server.listen(0,"127.0.0.1",ok));
    const base="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
    const request=(method:string,path:string,payload?:unknown)=>fetch(base+path,{
      method,headers:{Authorization:"Bearer "+demo.token,...(payload?{"content-type":"application/json"}:{})},
      ...(payload?{body:JSON.stringify(payload)}:{}),
    });
    const id="mission-auto-timer";
    assert.equal((await request("POST","/ops/missions",{plan:{...mission,id}})).status,201);
    assert.equal((await request("POST","/ops/missions/"+id+"/automation/start",{maxStarts:2})).status,201);
    let last:any;
    for(let attempt=0;attempt<90;attempt++){
      await new Promise(done=>setTimeout(done,20));
      const response=await request("GET","/ops/missions");
      assert.equal(response.status,200);
      last=(await response.json() as any).missions[id];
      if(last.automation.stoppedReason==="complete")break;
    }
    assert.equal(last.automation.stoppedReason,"complete");
    assert.equal(last.automation.starts,2);
    assert.equal(last.tasks["task-clean"].status,"done");
    assert.equal(last.tasks["task-count"].status,"done");
    assert.equal(last.tasks["task-count"].run.verification,"not-evaluated");
  }finally{await demo.close()}
});

test("HTTP accepts explicit restart consent only for the approved local mission queue",async()=>{
  const demo=createDemoServer({schedulerIntervalMs:0});
  try{
    await new Promise<void>(ok=>demo.server.listen(0,"127.0.0.1",ok));
    const base="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
    const call=(method:string,path:string,payload?:unknown)=>fetch(base+path,{
      method,headers:{Authorization:"Bearer "+demo.token,...(payload?{"content-type":"application/json"}:{})},
      ...(payload?{body:JSON.stringify(payload)}:{}),
    });
    const id="mission-approved-api-restart";
    assert.equal((await call("POST","/ops/missions",{plan:{...mission,id}})).status,201);
    const path="/ops/missions/"+id+"/automation/start";
    assert.equal((await call("POST",path,{maxStarts:2,resumeAfterRestart:true})).status,201);
    const payload=await(await call("GET","/ops/missions")).json() as any;
    assert.equal(payload.missions[id].automation.resumeAfterRestart,true);
    assert.equal(payload.missions[id].automation.enabled,true);
    assert.equal(payload.missions[id].automation.starts,0);
  }finally{await demo.close()}
});

import {test} from "node:test";
import assert from "node:assert/strict";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "../scripts/local-demo.ts";

test("HTTP can append a reviewed dependent task without losing completed results",async()=>{
  const demo=createDemoServer({schedulerIntervalMs:0});
  try{
    await new Promise<void>(ok=>demo.server.listen(0,"127.0.0.1",ok));
    const base="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
    const call=(method:string,path:string,payload?:unknown)=>fetch(base+path,{
      method,headers:{Authorization:"Bearer "+demo.token,...(payload?{"content-type":"application/json"}:{})},
      ...(payload?{body:JSON.stringify(payload)}:{}),
    });
    const plan={
      id:"mission-http-replan",title:"Plan uitbreiden",goal:"Behoud voltooid werk",
      tasks:[{id:"task-clean",title:"Schoonmaken",taskKind:"text-normalize",
        dependsOn:[],input:{text:"  Hallo  wereld  "}}],
    };
    assert.equal((await call("POST","/ops/missions",{plan})).status,201);
    assert.equal((await call("POST","/ops/missions/"+plan.id+"/step",{})).status,200);
    const before=(await(await call("GET","/ops/missions")).json() as any).missions[plan.id];
    assert.equal(before.revision,1);
    assert.equal(before.tasks["task-clean"].status,"done");
    const firstRun=before.tasks["task-clean"].run.runId;
    const extension={...plan,tasks:[...plan.tasks,
      {id:"task-count",title:"Tellen",taskKind:"text-metrics",
        dependsOn:["task-clean"],textFrom:"task-clean"}]};
    const route="/ops/missions/"+plan.id+"/extend";
    assert.equal((await call("POST",route,{plan:extension,expectedRevision:0})).status,422);
    assert.equal((await call("POST",route,{plan:extension,expectedRevision:1,override:true})).status,422);
    assert.equal((await call("POST","/ops/events",
      {type:"mission.extend",missionId:plan.id,plan:extension,expectedRevision:1})).status,403);
    assert.equal((await call("POST",route,{plan:extension,expectedRevision:1})).status,201);
    assert.equal((await call("POST",route,{plan:extension,expectedRevision:1})).status,422);
    let after=(await(await call("GET","/ops/missions")).json() as any).missions[plan.id];
    assert.equal(after.revision,2);
    assert.equal(after.tasks["task-clean"].run.runId,firstRun);
    assert.equal(after.tasks["task-count"].status,"queued");
    assert.equal((await call("POST","/ops/missions/"+plan.id+"/step",{})).status,200);
    after=(await(await call("GET","/ops/missions")).json() as any).missions[plan.id];
    assert.equal(after.tasks["task-clean"].run.runId,firstRun);
    assert.equal(after.tasks["task-count"].run.output.words,2);
    assert.equal(after.progress.status,"complete");
  }finally{await demo.close()}
});

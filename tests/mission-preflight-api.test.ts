import {test} from "node:test";
import assert from "node:assert/strict";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "../scripts/local-demo.ts";

test("read-only plan preflight returns real worker candidates but cannot authorize or start a mission",async()=>{
  const demo=createDemoServer({schedulerIntervalMs:0});
  try{
    await new Promise<void>(resolve=>demo.server.listen(0,"127.0.0.1",resolve));
    const url="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
    const call=(method:string,path:string,payload?:unknown,token=demo.token)=>fetch(url+path,{
      method,headers:{Authorization:"Bearer "+token,...(payload?{"content-type":"application/json"}:{})},
      ...(payload?{body:JSON.stringify(payload)}:{}),
    });
    const plan={
      id:"mission-proposed-test",title:"Twee lokale fasen",goal:"Bekijk uitvoerbaarheid zonder start",
      tasks:[
        {id:"task-first",title:"Normaliseren",taskKind:"text-normalize",dependsOn:[],
          input:{text:"  A  B  "}},
        {id:"task-second",title:"Meten",taskKind:"text-metrics",dependsOn:["task-first"],
          textFrom:"task-first"},
      ],
      phases:[
        {id:"phase-first",title:"Bewerken",taskIds:["task-first"]},
        {id:"phase-second",title:"Meten",taskIds:["task-second"]},
      ],
    };
    const endpoint="/ops/plans/preflight";
    assert.equal((await call("POST",endpoint,{plan},"invalid")).status,401);
    assert.equal((await call("POST",endpoint,{plan,unsafe:true})).status,422);
    assert.equal((await call("POST",endpoint,{plan:{...plan,phases:[plan.phases[0]]}})).status,422);
    const response=await call("POST",endpoint,{plan,missingInformation:["Is er een referentietekst?"]});
    assert.equal(response.status,200);
    const result=await response.json() as any;
    assert.equal(result.status,"requires-human-review");
    assert.equal(result.canExecute,false);
    assert.equal(result.instructionCoverage,"not-evaluated");
    assert.deepEqual(result.dependencyWaves,[["task-first"],["task-second"]]);
    assert.equal(result.tasks[0].selectedWorkerId,"text-normalize");
    assert.equal(result.tasks[0].workerAssessment,"candidate-only");
    assert.equal(result.tasks[1].selectedWorkerId,"text-metrics");
    assert.equal(result.tasks[1].workerAssessment,"candidate-only");
    assert.deepEqual(result.missingInformation,["Is er een referentietekst?"]);
    const noWorker={...plan,id:"mission-no-worker",
      tasks:[{...plan.tasks[0],taskKind:"fictional-specialist"},plan.tasks[1]]};
    const unknown=(await(await call("POST",endpoint,{plan:noWorker})).json()) as any;
    assert.equal(unknown.tasks[0].workerAssessment,"not-available");
    assert.equal(unknown.tasks[0].selectedWorkerId,null);
    assert.ok(unknown.tasks[0].blockers.includes("no-available-runtime-worker"));
    const restricted={...plan,tasks:[{...plan.tasks[0],evidenceAtomIds:["nonexistent.atom"]},plan.tasks[1]]};
    assert.equal((await call("POST",endpoint,{plan:restricted})).status,422);
    const all=await(await call("GET","/ops/missions")).json() as any;
    assert.equal(all.missions[plan.id],undefined);
    assert.equal(all.missions[noWorker.id],undefined);
    assert.equal((await call("GET","/ops/verify")).status,200);
  }finally{await demo.close()}
});

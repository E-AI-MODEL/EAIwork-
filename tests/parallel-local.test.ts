import {test} from "node:test";
import assert from "node:assert/strict";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "../scripts/local-demo.ts";

const setup=async()=>{
  const demo=createDemoServer({schedulerIntervalMs:0});
  await new Promise<void>(resolve=>demo.server.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
  const call=(method:string,path:string,payload?:unknown,token=demo.token)=>fetch(base+path,{
    method,headers:{Authorization:"Bearer "+token,...(payload?{"content-type":"application/json"}:{})},
    ...(payload?{body:JSON.stringify(payload)}:{}),
  });
  return {demo,call};
};

test("two independent deterministic text jobs are durably claimed and run in separate children",async()=>{
  const {demo,call}=await setup();
  try{
    const plan={
      id:"mission-parallel-basic",title:"Twee onafhankelijke tekstbewerkingen",
      goal:"Controleer twee lokale resultaten zonder model",
      tasks:[
        {id:"task-one",title:"Normaliseer",taskKind:"text-normalize",dependsOn:[],
          input:{text:"  Hallo  wereld  "}},
        {id:"task-two",title:"Tel",taskKind:"text-metrics",dependsOn:[],
          input:{text:"Een twee drie"}},
      ],
    };
    assert.equal((await call("POST","/ops/missions",{plan})).status,201);
    const route="/ops/missions/"+plan.id+"/parallel/run";
    assert.equal((await call("POST",route,{maxParallel:3})).status,422);
    assert.equal((await call("POST",route,{maxParallel:2,customCommand:"echo"})).status,422);
    assert.equal((await call("POST",route,{maxParallel:2},"incorrect")).status,401);
    const response=await call("POST",route,{maxParallel:2});
    assert.equal(response.status,200);
    const result=await response.json() as any;
    assert.deepEqual(result.claimed,["task-one","task-two"]);
    assert.deepEqual(result.completed,["task-one","task-two"]);
    assert.deepEqual(result.failed,[]);
    assert.equal(result.progress.status,"complete");
    const missions=await(await call("GET","/ops/missions")).json() as any;
    const m=missions.missions[plan.id];
    assert.equal(m.tasks["task-one"].run.output.text,"Hallo wereld");
    assert.equal(m.tasks["task-one"].run.output.changed,true);
    assert.equal(m.tasks["task-two"].run.output.words,3);
    assert.equal(m.tasks["task-one"].run.verification,"not-evaluated");
    assert.notEqual(m.tasks["task-one"].run.runId,m.tasks["task-two"].run.runId);
    const trace=await(await call("GET","/ops/missions/"+plan.id+"/trace")).json() as any;
    assert.equal(trace.counts.attempts,2);
    assert.equal(trace.tasks[0].attempts[0].status,"completed");
    assert.equal((await call("GET","/ops/verify")).status,200);
    const duplicate=await(await call("POST",route,{maxParallel:2})).json() as any;
    assert.deepEqual(duplicate.claimed,[]);
  }finally{await demo.close()}
});

test("parallel request never bypasses source-anchored prohibition or executes a repo worker",async()=>{
  const {demo,call}=await setup();
  try{
    const original="Maak een analyse, maar verstuur niets voordat iemand akkoord geeft.";
    const quote="verstuur niets";
    const start=original.indexOf(quote);
    const plan={
      id:"mission-parallel-gated",title:"Gereguleerde taken",
      goal:"Houd verzending tegen",
      sourceInstruction:original,
      constraints:[{id:"gate-prohibition",kind:"prohibition",quote,start,end:start+quote.length,
        taskIds:["task-one"]}],
      tasks:[
        {id:"task-one",title:"Tekst",taskKind:"text-normalize",dependsOn:[],
          input:{text:"  Niet verzenden  "}},
        {id:"task-two",title:"Repository",taskKind:"repo-search",dependsOn:[],
          input:{text:"AtomCapsule"}},
      ],
    };
    assert.equal((await call("POST","/ops/missions",{plan})).status,201);
    const route="/ops/missions/"+plan.id+"/parallel/run";
    const run=await(await call("POST",route,{maxParallel:2})).json() as any;
    assert.deepEqual(run.claimed,[]);
    assert.ok(run.blocked.some((x:any)=>x.taskId==="task-two"));
    const state=await(await call("GET","/ops/missions")).json() as any;
    assert.equal(state.missions[plan.id].tasks["task-one"].status,"queued");
    assert.equal(state.missions[plan.id].tasks["task-two"].status,"queued");
  }finally{await demo.close()}
});

test("parallel invocation refuses active automatic consent and cannot start duplicate jobs",async()=>{
  const {demo,call}=await setup();
  try{
    const plan={
      id:"mission-parallel-duplicate",title:"Geen dubbele taakstarts",
      goal:"Voorkom dubbele uitvoering",
      tasks:[
        {id:"task-one",title:"Normaliseer",taskKind:"text-normalize",dependsOn:[],
          input:{text:"  A  B "}},
        {id:"task-two",title:"Tellen",taskKind:"text-metrics",dependsOn:[],
          input:{text:"A B C"}},
      ],
    };
    assert.equal((await call("POST","/ops/missions",{plan})).status,201);
    const route="/ops/missions/"+plan.id+"/parallel/run";
    assert.equal((await call("POST","/ops/missions/"+plan.id+"/automation/start",
      {maxStarts:2})).status,201);
    assert.equal((await call("POST",route,{maxParallel:2})).status,422);
    assert.equal((await call("POST","/ops/missions/"+plan.id+"/automation/stop",{})).status,201);
    const [first,second]=await Promise.all([
      call("POST",route,{maxParallel:2}),call("POST",route,{maxParallel:2}),
    ]);
    assert.ok([first.status,second.status].includes(200));
    assert.ok([first.status,second.status].every(x=>x===200||x===409));
    const state=await(await call("GET","/ops/missions")).json() as any;
    const m=state.missions[plan.id];
    assert.equal(m.tasks["task-one"].status,"done");
    assert.equal(m.tasks["task-two"].status,"done");
    const trace=await(await call("GET","/ops/missions/"+plan.id+"/trace")).json() as any;
    assert.equal(trace.counts.attempts,2);
  }finally{await demo.close()}
});


test("an oversized child payload fails as a recorded task without leaking a worker slot",async()=>{
  const {demo,call}=await setup();
  try{
    const plan={
      id:"mission-parallel-input-bound",title:"Begrensde kindprocesinvoer",
      goal:"Bewaar falende taakstart en voltooi onafhankelijk werk",
      tasks:[
        {id:"task-oversize",title:"Veel UTF8-data",taskKind:"text-normalize",
          dependsOn:[],input:{text:"😀".repeat(6000)}},
        {id:"task-safe",title:"Kleine tekst",taskKind:"text-metrics",
          dependsOn:[],input:{text:"Twee woorden"}},
      ],
    };
    assert.equal((await call("POST","/ops/missions",{plan})).status,201);
    const route="/ops/missions/"+plan.id+"/parallel/run";
    const response=await call("POST",route,{maxParallel:2});
    assert.equal(response.status,200);
    const result=await response.json() as any;
    assert.deepEqual(result.claimed,["task-oversize","task-safe"]);
    assert.deepEqual(result.failed,["task-oversize"]);
    assert.deepEqual(result.completed,["task-safe"]);
    assert.equal(result.progress.status,"needs-review");
    const before=await(await call("GET","/ops/missions")).json() as any;
    assert.equal(before.missions[plan.id].tasks["task-oversize"].run.errorCode,"output-invalid");
    assert.equal(before.missions[plan.id].tasks["task-oversize"].status,"failed");
    assert.equal(before.missions[plan.id].tasks["task-safe"].run.output.words,2);
    const repeated=await(await call("POST",route,{maxParallel:2})).json() as any;
    assert.deepEqual(repeated.claimed,[]);
    const second={
      id:"mission-slots-released",title:"Kindprocessen opnieuw beschikbaar",
      goal:"Controleer dat de vorige fout geen slots vasthoudt",
      tasks:[{id:"task-reuse",title:"Nieuwe tekst",taskKind:"text-normalize",
        dependsOn:[],input:{text:"  Nieuwe  taak  "}}],
    };
    assert.equal((await call("POST","/ops/missions",{plan:second})).status,201);
    const next=await call("POST","/ops/missions/"+second.id+"/parallel/run",{maxParallel:2});
    assert.equal(next.status,200);
    assert.deepEqual((await next.json() as any).completed,["task-reuse"]);
  }finally{await demo.close()}
});

import {test} from "node:test";
import assert from "node:assert/strict";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "../scripts/local-demo.ts";
import {runExecutorBatch,runExecutorOnce} from "../scripts/local-text-executor.ts";
import {runPureTextAdapter,evaluateBuiltin} from "../packages/operations/src/execution.ts";
import {validateExecutorIdentities} from "../packages/operations/src/executor-channel.ts";

const source="  Lees [onderzoek](https://example.org/studie) en [cijfers](https://example.org/data).  ";
const specializedPlan=(id:string)=>({
  id,title:"Bronlinks en tekst controleren",
  goal:"Herken alleen verwijzingen; beoordeel bronnen niet automatisch",
  tasks:[
    {id:"task-clean",title:"Tekst normaliseren",taskKind:"text-normalize",
      dependsOn:[],input:{text:source}},
    {id:"task-links",title:"Links herkennen",taskKind:"reference-extract",
      dependsOn:["task-clean"],textFrom:"task-clean"},
    {id:"task-inspect",title:"Tekst inspecteren",taskKind:"text-inspect",
      dependsOn:["task-links"],textFrom:"task-links"},
    {id:"task-count",title:"Tekst tellen",taskKind:"text-metrics",
      dependsOn:["task-inspect"],textFrom:"task-inspect"},
  ],
});
async function setup(){
  const demo=createDemoServer({schedulerIntervalMs:0});
  await new Promise<void>(resolve=>demo.server.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
  const post=(path:string,body:unknown={},token=demo.token)=>fetch(base+path,{
    method:"POST",redirect:"error",
    headers:{"content-type":"application/json",authorization:"Bearer "+token},
    body:JSON.stringify(body),
  });
  const get=(path:string,token=demo.token)=>fetch(base+path,{
    headers:{authorization:"Bearer "+token},
  });
  return {demo,base,post,get};
}
test("four fixed specialties run as a bounded dependent leased mission",async()=>{
  const h=await setup();
  try{
    const id="mission-four-specialties";
    assert.equal((await h.post("/ops/missions",{plan:specializedPlan(id)})).status,201);
    assert.equal((await h.post("/ops/missions/"+id+"/automation/start",{
      maxStarts:4,executionMode:"remote-text",executorIds:["executor-local-demo"],
    })).status,201);
    assert.equal((await h.post("/executor/v1/claim",{},h.demo.otherWorkerToken)).status,204);
    const result=await runExecutorBatch(h.base,h.demo.workerToken,{maxTasks:4});
    assert.equal(result.completed,4);
    assert.equal((await runExecutorOnce(h.base,h.demo.workerToken)).status,"idle");
    const state=await(await h.get("/ops/missions")).json() as any;
    const mission=state.missions[id];
    assert.equal(mission.automation.starts,4);
    assert.equal(mission.tasks["task-clean"].status,"done");
    assert.equal(mission.tasks["task-links"].status,"done");
    assert.equal(mission.tasks["task-inspect"].status,"done");
    assert.equal(mission.tasks["task-count"].status,"done");
    const links=mission.tasks["task-links"].run;
    assert.equal(links.workerId,"reference-extract");
    assert.equal(links.adapterId,"reference-extract");
    assert.equal(links.verification,"not-evaluated");
    assert.equal(links.output.review,"links-not-verified");
    assert.equal(links.output.detected,2);
    assert.equal(links.output.truncated,false);
    assert.deepEqual(links.output.references,[
      {label:"onderzoek",url:"https://example.org/studie"},
      {label:"cijfers",url:"https://example.org/data"},
    ]);
    const inspected=mission.tasks["task-inspect"].run;
    assert.equal(inspected.workerId,"text-inspector");
    assert.equal(inspected.adapterId,"text-inspect");
    assert.equal(inspected.verification,"not-evaluated");
    assert.equal(inspected.output.changed,false);
    assert.equal(inspected.output.text,source.trim().replace(/ {2,}/g," "));
    assert.equal(inspected.output.words,mission.tasks["task-count"].run.output.words);
    const trace=await(await h.get("/ops/missions/"+id+"/trace")).json() as any;
    assert.equal(trace.counts.attempts,4);
    assert.equal((await h.get("/ops/verify")).status,200);
  }finally{await h.demo.close()}
});
test("wrong executor and invented source verification are rejected",async()=>{
  const h=await setup();
  try{
    const id="mission-reference-forgery";
    const plan={id,title:"Broncontrole zonder fictief bewijs",
      goal:"Bewaar uitsluitend wat de parser daadwerkelijk vond",
      tasks:[{id:"task-links",title:"Verwijzingen",taskKind:"reference-extract",
        dependsOn:[],input:{text:"Lees [bron](https://example.org)"} }],
    };
    assert.equal((await h.post("/ops/missions",{plan})).status,201);
    assert.equal((await h.post("/ops/missions/"+id+"/automation/start",{
      maxStarts:1,executionMode:"remote-text",executorIds:["executor-local-demo"],
    })).status,201);
    assert.equal((await h.post("/executor/v1/claim",{},h.demo.otherWorkerToken)).status,204);
    const claim=await h.post("/executor/v1/claim",{},h.demo.workerToken);
    assert.equal(claim.status,200);
    const job=await claim.json() as any;
    assert.equal(job.kind,"reference-extract");
    const ref={missionId:id,taskId:job.taskId,runId:job.runId,leaseId:job.leaseId};
    const forged=runPureTextAdapter(job.kind,job.input);
    (forged as any).review="verified";
    assert.equal((await h.post("/executor/v1/complete",
      {...ref,output:forged},h.demo.otherWorkerToken)).status,409);
    assert.equal((await h.post("/executor/v1/complete",
      {...ref,output:forged},h.demo.workerToken)).status,409);
    const state=await(await h.get("/ops/missions")).json() as any;
    assert.equal(state.missions[id].tasks["task-links"].status,"failed");
    assert.equal(state.missions[id].tasks["task-links"].run.errorCode,"output-invalid");
    assert.equal(state.missions[id].tasks["task-links"].run.output,undefined);
    assert.equal((await h.post("/executor/v1/claim",{},h.demo.workerToken)).status,204);
    assert.equal((await h.get("/ops/verify")).status,200);
  }finally{await h.demo.close()}
});
test("fixed specialist fixtures and executor identity limits remain restrictive",()=>{
  const noSideEffects={
    id:"reference-extract",version:"1.0.0",taskKinds:["reference-extract"],
    testSuite:"builtin-fixture-v1",modelPolicy:{preferred:"deterministic"},
    tools:[],requestedPermissions:[],
  };
  const fixture=evaluateBuiltin("reference-extract",noSideEffects);
  assert.equal(fixture.numerator,3);
  assert.equal(fixture.denominator,3);
  assert.throws(()=>evaluateBuiltin("reference-extract",{
    ...noSideEffects,requestedPermissions:["network:read"],
  }),/no trusted fixture suite/);
  assert.deepEqual(runPureTextAdapter("reference-extract",{
    text:"[bad](javascript:alert) [user](https://user:pass@example.org/)",
  }),{
    text:"[bad](javascript:alert) [user](https://user:pass@example.org/)",
    references:[],detected:0,truncated:false,review:"links-not-verified",
  });
  const allKinds=["text-normalize","text-metrics","text-inspect","reference-extract"] as const;
  assert.doesNotThrow(()=>validateExecutorIdentities({
    ["a".repeat(32)]:{ownerId:"executor-all-four",taskKinds:[...allKinds]},
  },new Set()));
  assert.throws(()=>validateExecutorIdentities({
    ["a".repeat(32)]:{ownerId:"executor-too-broad",
      taskKinds:[...allKinds,"repo-search" as any]},
  },new Set()),/four known/);
  assert.throws(()=>runPureTextAdapter("repo-search",{text:"github"}),/unsupported pure text/);
});

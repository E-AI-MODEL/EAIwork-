import {test} from "node:test";
import assert from "node:assert/strict";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "../scripts/local-demo.ts";

const demoPlan=(id:string,kind="text-inspect")=>({
  id,title:"Ontbrekende worker bouwen",goal:"Voer lokale tekstinspectie uit",
  tasks:[{id:"task-inspect",title:"Inspecteer tekst",taskKind:kind,dependsOn:[],
    input:{text:"  Hallo  EAIwork wereld  "}}],
});

test("vacature -> Builder -> echte fixture -> menselijke release -> oorspronkelijke taak",async()=>{
  const demo=createDemoServer({schedulerIntervalMs:0,seedDemoData:false});
  try{
    await new Promise<void>(resolve=>demo.server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+(demo.server.address() as AddressInfo).port;
    const request=(method:string,path:string,body?:unknown,token=demo.token)=>fetch(base+path,{
      method,
      headers:{authorization:"Bearer "+token,...(body!==undefined?{"content-type":"application/json"}:{})},
      ...(body!==undefined?{body:JSON.stringify(body)}:{}),
    });
    const id="mission-builder-vacancy";
    assert.equal((await request("POST","/ops/missions",{plan:demoPlan(id)})).status,201);
    const needs="/ops/missions/"+id+"/worker-needs";
    assert.equal((await request("GET",needs,undefined,"wrong-token")).status,401);
    const first=await(await request("GET",needs)).json() as any;
    assert.equal(first.status,"ready");
    assert.equal(first.canPrepare,true);
    assert.equal(first.needs[0].taskId,"task-inspect");
    assert.equal(first.needs[0].status,"buildable");
    assert.equal(first.needs[0].workerId,"text-inspector");
    const runBefore=await(await request("POST","/ops/missions/"+id+"/run",{})).json() as any;
    assert.equal(runBefore.stopReason,"blocked");

    const prepare="/ops/missions/"+id+"/workers/prepare";
    assert.equal((await request("POST",prepare,{expectedRevision:1,taskId:"task-inspect"},"invalid")).status,401);
    assert.equal((await request("POST",prepare,{expectedRevision:1,taskId:"task-inspect"},demo.reviewerToken)).status,403);
    assert.equal((await request("POST",prepare,{expectedRevision:2,taskId:"task-inspect"})).status,422);
    assert.equal((await request("POST",prepare,{expectedRevision:1,taskId:"task-inspect",permissions:["*"]})).status,422);

    const built=await request("POST",prepare,{expectedRevision:1,taskId:"task-inspect"});
    assert.equal(built.status,201);
    const candidate=await built.json() as any;
    assert.equal(candidate.status,"candidate-tested");
    assert.equal(candidate.workerId,"text-inspector");
    assert.equal(candidate.approvalRequired,true);
    assert.equal(candidate.passed,true);
    assert.match(candidate.evidenceRef,/^builtin-fixtures:/);

    const second=await(await request("GET",needs)).json() as any;
    assert.equal(second.needs[0].status,"awaiting-release");
    assert.equal(second.needs[0].evidenceRef,candidate.evidenceRef);
    assert.equal(second.canPrepare,false);
    assert.equal((await request("POST",prepare,{expectedRevision:1,taskId:"task-inspect"})).status,422);
    const beforeRelease=await(await request("GET","/ops/state")).json() as any;
    assert.equal(beforeRelease.missions[id].tasks["task-inspect"].status,"queued");
    assert.equal(beforeRelease.workers["text-inspector"].stage,"candidate");
    const stillBlocked=await(await request("POST","/ops/missions/"+id+"/run",{})).json() as any;
    assert.equal(stillBlocked.stopReason,"blocked");

    // Never let the Builder release a worker. A person must act through the
    // existing event interface with exact-version, independently recorded tests.
    assert.equal((await request("POST","/ops/events",{
      type:"worker.release",id:"text-inspector",evidenceRef:"invented"
    })).status,422);
    const released=await request("POST","/ops/events",{
      type:"worker.release",id:"text-inspector",evidenceRef:candidate.evidenceRef,
    });
    assert.equal(released.status,201);
    const ready=await(await request("GET",needs)).json() as any;
    assert.equal(ready.needs[0].status,"available");
    assert.equal(ready.canPrepare,false);
    // Reuse the pre-existing, separately authorized scheduler. The Builder
    // does not launch the worker or grant a background execution budget.
    assert.equal((await request("POST","/ops/missions/"+id+"/automation/start",{maxStarts:1})).status,201);
    assert.ok(demo.scheduler);
    assert.deepEqual(demo.scheduler.tick().stopped,[{missionId:id,reason:"complete"}]);
    const state=await(await request("GET","/ops/missions")).json() as any;
    const output=state.missions[id].tasks["task-inspect"].run.output;
    assert.equal(output.text,"Hallo EAIwork wereld");
    assert.equal(output.words,3);
    assert.equal(state.missions[id].tasks["task-inspect"].run.verification,"not-evaluated");
    assert.equal((await(await request("GET","/ops/verify")).json() as any).ok,true);
  }finally{await demo.close()}
});

test("unknown recipe or blocked condition never launches Builder or a new worker",async()=>{
  const demo=createDemoServer({schedulerIntervalMs:0,seedDemoData:false});
  try{
    await new Promise<void>(resolve=>demo.server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+(demo.server.address() as AddressInfo).port;
    const req=(method:string,path:string,body?:unknown)=>fetch(base+path,{method,
      headers:{authorization:"Bearer "+demo.token,...(body!==undefined?{"content-type":"application/json"}:{})},
      ...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const missing="mission-unsupported-worker";
    assert.equal((await req("POST","/ops/missions",{plan:demoPlan(missing,"unknown-viz")})).status,201);
    const view=await(await req("GET","/ops/missions/"+missing+"/worker-needs")).json() as any;
    assert.equal(view.needs[0].status,"unsupported");
    assert.equal(view.canPrepare,false);
    assert.equal((await req("POST","/ops/missions/"+missing+"/workers/prepare",
      {taskId:"task-inspect",expectedRevision:1})).status,422);
    const gated="mission-builder-gated";
    const src="Voer pas na toestemming de taak uit";
    const start=src.indexOf("toestemming");
    const plan={
      ...demoPlan(gated),
      sourceInstruction:src,
      constraints:[{id:"gate-approval",kind:"approval",quote:"toestemming",
        start,end:start+"toestemming".length,taskIds:["task-inspect"],approverId:"person:demo"}],
    };
    assert.equal((await req("POST","/ops/missions",{plan})).status,201);
    const blocked=await(await req("GET","/ops/missions/"+gated+"/worker-needs")).json() as any;
    assert.equal(blocked.needs[0].status,"condition-blocked");
    assert.equal(blocked.canPrepare,false);
    assert.equal((await req("POST","/ops/missions/"+gated+"/workers/prepare",
      {taskId:"task-inspect",expectedRevision:1})).status,422);
    const state=await(await req("GET","/ops/state")).json() as any;
    assert.deepEqual(Object.keys(state.workers),[]);
  }finally{await demo.close()}
});

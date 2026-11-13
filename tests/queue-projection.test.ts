import {test} from "node:test";
import assert from "node:assert/strict";
import {applyOps,emptyOps,type OpsEvent,type OpsActor} from "../packages/operations/src/registry.ts";
import {projectLocalQueue} from "../packages/operations/src/queue.ts";
import {createDemoServer} from "../scripts/local-demo.ts";
import type {AddressInfo} from "node:net";

const t="2026-11-10T09:00:00.000Z";
const now=Date.parse(t);
const person:OpsActor={kind:"person",id:"person:operator"};
const runner:OpsActor={kind:"system",id:"system:mission-runner"};
let eventId=0;
const apply=(state:ReturnType<typeof emptyOps>,event:OpsEvent,actor:OpsActor=person,at=t)=>
  applyOps(state,{id:"queue-event-"+(++eventId),at,actor,event});
const plan={
  id:"mission-queue-review",title:"Wachtrijtoestand",goal:"Toon geclaimde en wachtende taken",
  tasks:[
    {id:"task-one",title:"Tekst een",taskKind:"text-normalize",dependsOn:[],
      input:{text:"Geheim invoerveld test"}},
    {id:"task-two",title:"Tekst twee",taskKind:"text-metrics",dependsOn:["task-one"],
      textFrom:"task-one"},
    {id:"task-three",title:"Onbekende taak",taskKind:"remote-action",
      effect:"local" as const,dependsOn:[],input:{text:"Niet uitvoeren"}},
  ],
};
test("queue is a read-only projection of durable task and lease state without task inputs",()=>{
  let state=apply(emptyOps(),{type:"mission.create",plan});
  const before=structuredClone(state);
  let queue=projectLocalQueue(state,now);
  assert.equal(queue.autoDispatch,false);
  assert.equal(queue.counts.ready,1);
  assert.equal(queue.rows.find(x=>x.taskId==="task-one")?.status,"ready");
  assert.equal(queue.rows.find(x=>x.taskId==="task-two")?.status,"blocked");
  assert.equal(queue.rows.find(x=>x.taskId==="task-three")?.status,"blocked");
  assert.equal(JSON.stringify(queue).includes("Geheim invoerveld"),false);
  assert.deepEqual(state,before);
  const run={runId:"run-queue",workerId:"text-normalize",workerVersion:"1.0.0",
    adapterId:"text-normalize",inputHash:"a".repeat(64),
    startedAt:t,verification:"not-evaluated" as const};
  state=apply(state,{type:"task.lease.claim",missionId:plan.id,taskId:"task-one",
    run,leaseId:"lease-queue",ownerId:"local-subprocess",
    expiresAt:"2026-11-10T09:00:10.000Z"},runner);
  queue=projectLocalQueue(state,now+1000);
  assert.equal(queue.counts.leased,1);
  assert.equal(queue.rows.find(x=>x.taskId==="task-one")?.leaseId,"lease-queue");
  queue=projectLocalQueue(state,now+11000);
  assert.equal(queue.counts.expired,1);
  assert.equal(queue.rows.find(x=>x.taskId==="task-one")?.status,"lease-expired");
  assert.equal(state.missions[plan.id].tasks["task-one"].status,"running",
    "read-only inspection never changes canonical task state");
  state=apply(state,{type:"task.lease.expire",missionId:plan.id,taskId:"task-one",
    runId:"run-queue",leaseId:"lease-queue"},runner,"2026-11-10T09:00:11.000Z");
  queue=projectLocalQueue(state,now+11000);
  assert.equal(queue.counts.expired,0);
  assert.equal(queue.counts.needsReview,1);
  assert.equal(queue.rows.find(x=>x.taskId==="task-one")?.status,"needs-review");
});
test("authenticated queue API is read-only and returns no source text",async()=>{
  const demo=createDemoServer({schedulerIntervalMs:0});
  try{
    await new Promise<void>(done=>demo.server.listen(0,"127.0.0.1",done));
    const host="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
    const unauth=await fetch(host+"/ops/queue");
    assert.equal(unauth.status,401);
    const get=()=>fetch(host+"/ops/queue",{headers:{
      Authorization:"Bearer "+demo.token,
    }});
    const response=await get();
    assert.equal(response.status,200);
    const data=await response.json() as any;
    assert.equal(data.schema,"eai-local-queue-v1");
    assert.equal(data.autoDispatch,false);
    assert.ok(Array.isArray(data.rows));
    assert.ok(data.rows.some((x:any)=>x.missionId==="mission-demo-automatic"));
    assert.equal(JSON.stringify(data).includes("Hallo  EAIwork"),false);
    assert.ok(data.rows.every((x:any)=>!("input" in x)&&!("output" in x)));
    for(const type of ["task.lease.claim","task.lease.renew","task.lease.expire"]){
      const rejected=await fetch(host+"/ops/events",{method:"POST",
        headers:{Authorization:"Bearer "+demo.token,"content-type":"application/json"},
        body:JSON.stringify({type,missionId:"mission-demo-automatic",
          taskId:"task-clean-auto",runId:"fake",leaseId:"fake"}),
      });
      assert.equal(rejected.status,403);
    }
    assert.equal((await get()).status,200);
  }finally{await demo.close()}
});

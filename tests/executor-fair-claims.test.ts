import {test} from "node:test";
import assert from "node:assert/strict";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "../scripts/local-demo.ts";

test("multiple ready missions receive claims fairly without changing authorization or budgets",async()=>{
  const demo=createDemoServer({schedulerIntervalMs:0});
  try{
    await new Promise<void>(resolve=>demo.server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
    const post=(path:string,body:unknown={},token=demo.token)=>fetch(base+path,{
      method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},
      body:JSON.stringify(body),
    });
    const get=async()=> (await(await fetch(base+"/ops/missions",{
      headers:{authorization:"Bearer "+demo.token},
    })).json()) as any;
    const many={
      id:"mission-aaa-long",title:"Langere opdracht",goal:"Verdeel de beschikbare capaciteit",
      tasks:Array.from({length:3},(_,i)=>({
        id:"task-long-"+(i+1),title:"Lokale tekst "+(i+1),
        taskKind:"text-normalize",dependsOn:[],input:{text:"  Lang "+(i+1)+"  "},
      })),
    };
    const short={
      id:"mission-zzz-short",title:"Kortere opdracht",goal:"Krijg een eerlijke beurt",
      tasks:[{id:"task-short",title:"Korte tekst",taskKind:"text-normalize",
        dependsOn:[],input:{text:"  Kort  "}}],
    };
    assert.equal((await post("/ops/missions",{plan:many})).status,201);
    assert.equal((await post("/ops/missions",{plan:short})).status,201);
    for(const [id,budget] of [[many.id,3],[short.id,1]] as const)
      assert.equal((await post("/ops/missions/"+id+"/automation/start",{
        maxStarts:budget,executionMode:"remote-text",
        executorIds:["executor-local-demo"],
      })).status,201);
    const claim=()=>post("/executor/v1/claim",{},demo.workerToken);
    const first=await claim();
    assert.equal(first.status,200);
    const jobA=await first.json() as any;
    assert.equal(jobA.missionId,many.id);
    assert.equal(jobA.taskId,"task-long-1");
    const second=await claim();
    assert.equal(second.status,200);
    const jobB=await second.json() as any;
    // Previously a second alphabetical claim would take task-long-2.
    assert.equal(jobB.missionId,short.id);
    assert.equal(jobB.taskId,"task-short");
    assert.equal((await claim()).status,204,"two live leases fill the global capacity");
    assert.equal((await post("/executor/v1/claim",{},demo.otherWorkerToken)).status,204);
    const finish=(job:any,output:{text:string;changed:boolean})=>
      post("/executor/v1/complete",{
        missionId:job.missionId,taskId:job.taskId,
        runId:job.runId,leaseId:job.leaseId,output,
      },demo.workerToken);
    assert.equal((await finish(jobA,{text:"Lang 1",changed:true})).status,200);
    assert.equal((await finish(jobB,{text:"Kort",changed:true})).status,200);
    const next=await claim();
    assert.equal(next.status,200);
    const jobC=await next.json() as any;
    assert.equal(jobC.missionId,many.id);
    assert.equal(jobC.taskId,"task-long-2");
    assert.equal((await finish(jobC,{text:"Lang 2",changed:true})).status,200);
    const after=(await get()).missions;
    assert.equal(after[short.id].tasks["task-short"].status,"done");
    assert.equal(after[short.id].automation.starts,1);
    assert.equal(after[many.id].tasks["task-long-1"].status,"done");
    assert.equal(after[many.id].tasks["task-long-2"].status,"done");
    assert.equal(after[many.id].automation.starts,2);
    assert.equal((await(await fetch(base+"/ops/verify",{
      headers:{authorization:"Bearer "+demo.token},
    })).json() as any).ok,true);
  }finally{await demo.close()}
});

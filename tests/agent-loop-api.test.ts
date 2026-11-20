import {test} from "node:test";
import assert from "node:assert/strict";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "../scripts/local-demo.ts";

test("authenticated mission owner runs native agent cycle, with no automatic privileges",async()=>{
  const demo=createDemoServer({schedulerIntervalMs:0});
  try{
    await new Promise<void>(ok=>demo.server.listen(0,"127.0.0.1",ok));
    const base="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
    const call=async(path:string,payload:unknown,token=demo.token)=>fetch(base+path,{
      method:"POST",headers:{Authorization:"Bearer "+token,"content-type":"application/json"},
      body:JSON.stringify(payload),
    });
    const id="mission-native-agent-http";
    const plan={id,title:"Native agent",goal:"Twee lokale, toegelaten taken",
      tasks:[
        {id:"task-clean",title:"Opschonen",taskKind:"text-normalize",dependsOn:[],input:{text:" Hallo wereld  "}},
        {id:"task-count",title:"Tellen",taskKind:"text-metrics",dependsOn:["task-clean"],textFrom:"task-clean"},
      ],
    };
    assert.equal((await call("/ops/missions",{plan})).status,201);
    const path="/ops/missions/"+id+"/agent/cycle";
    assert.equal((await call(path,{maxStarts:8},"invalid-token")).status,401);
    assert.equal((await call(path,{maxStarts:0})).status,422);
    assert.equal((await call(path,{maxStarts:9})).status,422);
    assert.equal((await call(path,{maxStarts:2,allowPublish:true})).status,422);
    assert.equal((await call(path,{maxStarts:2,proposeOnBlock:"yes"})).status,422);
    assert.equal((await call(path,{maxStarts:2,proposeOnBlock:true})).status,503);
    const run=await call(path,{maxStarts:1});
    assert.equal(run.status,200);
    const first=await run.json() as any;
    assert.equal(first.starts,1);
    assert.equal(first.stopReason,"budget-exhausted");
    const second=await call(path,{maxStarts:1});
    assert.equal(second.status,200);
    const final=await second.json() as any;
    assert.equal(final.starts,1);
    assert.equal(final.stopReason,"complete");
    assert.equal(final.progress.done,2);
    assert.equal(final.revisionProposal,undefined);
    const snapshot=await fetch(base+"/ops/missions",{
      headers:{Authorization:"Bearer "+demo.token},
    });
    const state=await snapshot.json() as any;
    assert.equal(state.missions[id].tasks["task-count"].run.verification,"not-evaluated");
    assert.equal((await fetch(base+"/ops/verify",{
      headers:{Authorization:"Bearer "+demo.token},
    })).status,200);
  }finally{await demo.close()}
});

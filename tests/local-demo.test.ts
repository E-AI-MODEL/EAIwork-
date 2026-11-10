import {test} from "node:test";
import assert from "node:assert/strict";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "../scripts/local-demo.ts";

test("ephemeral local demo starts with real registered workers, trace and executable missions",async()=>{
  const demo=createDemoServer();
  try{
    await new Promise<void>(ok=>demo.server.listen(0,"127.0.0.1",()=>ok()));
    const base="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
    const request=(method:string,path:string,body?:unknown,token=demo.token)=>fetch(base+path,{
      method,headers:{Authorization:"Bearer "+token,...(body?{"content-type":"application/json"}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),
    });
    assert.equal((await request("GET","/dashboard")).status,200);
    assert.equal((await request("GET","/ops/state",undefined,"wrong")).status,401);
    const state=await(await request("GET","/ops/state")).json() as any;
    assert.equal(Object.keys(state.workers).length,5);
    assert.equal(Object.values(state.workers).filter((w:any)=>w.stage==="ready").length,5);
    assert.equal(state.workers["reference-extract"].stage,"ready");
    assert.equal(state.workers["text-inspector"].stage,"ready");
    assert.equal(state.measurements.length,5);
    assert.equal(Object.keys(state.missions).length,4);
    assert.equal(state.missions["mission-demo-automatic"].tasks["task-clean-auto"].status,"queued");
    assert.equal(state.missions["mission-demo-text"].tasks["task-clean"].status,"done");
    assert.equal(state.missions["mission-demo-repo"].tasks["task-search"].status,"queued");
    const trace=await(await request("GET","/ops/missions/mission-demo-text/trace")).json() as any;
    assert.equal(trace.counts.attempts,2);
    assert.equal(trace.tasks[0].attempts[0].status,"completed");
    assert.equal(trace.tasks[0].verification,"not-evaluated");
    const composed=await(await request("POST","/ops/missions/mission-demo-compose/run",{})).json() as any;
    assert.equal(composed.stopReason,"complete");
    const repos=await(await request("POST","/ops/missions/mission-demo-repo/run",{})).json() as any;
    assert.equal(repos.stopReason,"complete");
    const after=await(await request("GET","/ops/missions")).json() as any;
    assert.equal(after.missions["mission-demo-compose"].tasks["task-inspect"].run.output.words,3);
    assert.ok(Array.isArray(after.missions["mission-demo-repo"].tasks["task-search"].run.output.results));
    const verified=await(await request("GET","/ops/verify")).json() as any;
    assert.equal(verified.ok,true);
  }finally{await demo.close()}
});

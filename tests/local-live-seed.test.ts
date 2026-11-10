import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "../scripts/local-demo.ts";

test("old locally saved demo entries stay in the journal but disappear from the live API",async()=>{
  const profile=mkdtempSync(join(tmpdir(),"eaiwork-old-demo-"));
  let old:createDemoReturn|undefined;
  let live:createDemoReturn|undefined;
  try{
    old=createDemoServer({persistentDir:profile,schedulerIntervalMs:0,seedDemoData:true,localLiveView:false});
    const original=old.operations!.snapshot();
    assert.equal(Object.keys(original.missions).length,4);
    assert.equal(Object.keys(original.workers).length,4);
    const originalCount=original.history.length;
    await old.close();old=undefined;
    live=createDemoServer({persistentDir:profile,schedulerIntervalMs:0,seedDemoData:false,localLiveView:true});
    await new Promise<void>(done=>live!.server.listen(0,"127.0.0.1",()=>done()));
    const origin="http://127.0.0.1:"+((live.server.address() as AddressInfo).port);
    const get=async(path:string)=>{
      const response=await fetch(origin+path,{headers:{authorization:"Bearer "+live!.token}});
      assert.equal(response.status,200,path+" unavailable");
      return response.json();
    };
    const visible=await get("/ops/state");
    assert.deepEqual(Object.keys(visible.missions),[]);
    assert.deepEqual(Object.keys(visible.workers),[]);
    assert.deepEqual(visible.measurements,[]);
    assert.deepEqual(visible.history,[]);
    assert.equal((await get("/ops/catalog")).workers?.length??0,0);
    assert.deepEqual(Object.keys((await get("/ops/missions")).missions),[]);
    assert.equal((await get("/ops/verify")).ok,true);
    assert.equal(live.operations!.snapshot().history.length,originalCount,
      "filtering must not remove or rewrite existing signed records");
  }finally{
    if(old)await old.close();
    if(live)await live.close();
    rmSync(profile,{force:true,recursive:true});
  }
});
type createDemoReturn=ReturnType<typeof createDemoServer>;

test("an ordinary fresh local start creates no workers, missions or demo measurements",async()=>{
  const profile=mkdtempSync(join(tmpdir(),"eaiwork-blank-local-"));
  const server=createDemoServer({persistentDir:profile,schedulerIntervalMs:0,seedDemoData:false,localLiveView:true});
  try{
    const state=server.operations!.snapshot();
    assert.equal(state.history.length,0);
    assert.deepEqual(Object.keys(state.workers),[]);
    assert.deepEqual(Object.keys(state.missions),[]);
  }finally{
    await server.close();
    rmSync(profile,{force:true,recursive:true});
  }
});

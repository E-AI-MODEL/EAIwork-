import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync,symlinkSync,unlinkSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "../scripts/local-demo.ts";
import {openLocalProfile} from "../scripts/local-profile.ts";

const fresh=()=>mkdtempSync(join(tmpdir(),"eaiwork-persistent-profile-"));
const plan=id=>({id,title:"Blijvend lokaal werk",goal:"Heropen een echte opdracht",
 tasks:[{id:"task-one",title:"Tekst opschonen",taskKind:"text-normalize",dependsOn:[],input:{text:"  Twee  woorden "}}]});
test("local profile retains signed keys, mission history and worker registry across restart",async()=>{
  const dir=fresh();let first;let second;
  try{
    first=createDemoServer({persistentDir:dir,schedulerIntervalMs:0});
    await new Promise(ok=>first!.server.listen(0,"127.0.0.1",ok));
    const origin="http://127.0.0.1:"+((first.server.address() as AddressInfo).port);
    const call=(path:string,body?:unknown)=>fetch(origin+path,{
      method:body?"POST":"GET",
      headers:{Authorization:"Bearer "+first!.token,...(body?{"content-type":"application/json"}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    const initial=await(await call("/ops/state")).json() as any;
    assert.equal(Object.keys(initial.missions).length,4);
    assert.equal((await call("/ops/missions",{plan:plan("mission-kept")})).status,201);
    assert.equal((await call("/ops/missions/mission-kept/run",{})).status,200);
    const before=await(await call("/ops/verify")).json() as any;
    assert.equal(before.ok,true);
    const witnessBefore=readFileSync(join(dir,"witness-private.pem"),"utf8");
    const operationsBefore=readFileSync(join(dir,"operations","worker-events.jsonl"),"utf8");
    await first.close();first=undefined;
    assert.ok(existsSync(join(dir,"operations","worker-events.jsonl")));
    assert.ok(existsSync(join(dir,"witness-private.pem")));
    second=createDemoServer({persistentDir:dir,schedulerIntervalMs:0});
    assert.notEqual(second.token,"");
    await new Promise(ok=>second!.server.listen(0,"127.0.0.1",ok));
    const base="http://127.0.0.1:"+((second.server.address() as AddressInfo).port);
    const reopened=await fetch(base+"/ops/missions",{headers:{Authorization:"Bearer "+second.token}});
    assert.equal(reopened.status,200);
    const state=await reopened.json() as any;
    assert.equal(Object.keys(state.missions).length,5,"reopening must not seed demo data twice");
    assert.equal(state.missions["mission-kept"].tasks["task-one"].status,"done");
    assert.equal(state.missions["mission-kept"].tasks["task-one"].run.verification,"not-evaluated");
    assert.equal(readFileSync(join(dir,"witness-private.pem"),"utf8"),witnessBefore);
    assert.equal(readFileSync(join(dir,"operations","worker-events.jsonl"),"utf8"),operationsBefore);
    assert.equal((await fetch(base+"/ops/state",{headers:{Authorization:"Bearer "+first?.token}})).status!==200,true);
  }finally{
    if(first)await first.close();
    if(second)await second.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
test("local profile refuses partial keys, symlinks and missing keys for existing journal",()=>{
  const dir=fresh();
  try{
    const profile=openLocalProfile(dir);
    unlinkSync(join(dir,"witness-public.pem"));
    assert.throws(()=>openLocalProfile(dir),/Onvolledige lokale sleutelset/);
    assert.ok(profile.privateKeyPem);
  }finally{rmSync(dir,{recursive:true,force:true})}
  const second=fresh(),link=join(tmpdir(),"eaiwork-profile-link-"+process.pid+"-"+Date.now());
  try{
    symlinkSync(second,link);
    assert.throws(()=>openLocalProfile(link),/symbolische link/);
    unlinkSync(link);
  }finally{if(existsSync(link))unlinkSync(link);rmSync(second,{recursive:true,force:true})}
  const third=fresh();let demo;
  try{
    demo=createDemoServer({persistentDir:third,schedulerIntervalMs:0});
    demo.close();demo=undefined;
    unlinkSync(join(third,"witness-private.pem"));
    unlinkSync(join(third,"witness-public.pem"));
    assert.throws(()=>openLocalProfile(third),/Bestaande gegevens zonder sleutels/);
  }finally{rmSync(third,{recursive:true,force:true})}
});
test("same persistent directory cannot have two active operations writers",async()=>{
  const dir=fresh();let first;
  try{
    first=createDemoServer({persistentDir:dir,schedulerIntervalMs:0});
    assert.throws(()=>createDemoServer({persistentDir:dir,schedulerIntervalMs:0}),/already active|writer/);
  }finally{if(first)await first.close();rmSync(dir,{recursive:true,force:true})}
});
test("corrupted persistent operations journal stops startup rather than resetting data",async()=>{
  const dir=fresh();let demo;
  try{
    demo=createDemoServer({persistentDir:dir,schedulerIntervalMs:0});
    await demo.close();demo=undefined;
    const journal=join(dir,"operations","worker-events.jsonl");
    writeFileSync(journal,readFileSync(journal,"utf8")+"broken tail");
    assert.throws(()=>createDemoServer({persistentDir:dir,schedulerIntervalMs:0}),/incomplete operations journal|integrity/);
  }finally{if(demo)await demo.close();rmSync(dir,{recursive:true,force:true})}
});

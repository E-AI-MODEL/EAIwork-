import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync,readFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { makeServer } from "../packages/server/src/server.ts";
import { SignedFileAnchorWitness } from "../packages/server/src/witness.ts";
import { validateMissionPlan } from "../packages/operations/src/missions.ts";

const mission={
  id:"mission-brief",
  title:"Lokaal tekstonderzoek",
  goal:"Schoon de invoertekst op en tel daarna de woorden met geregistreerde workers.",
  tasks:[
    {id:"task-clean",title:"Tekst normaliseren",taskKind:"text-normalize",dependsOn:[],input:{text:"  Hallo  wereld\r\nNu  "}},
    {id:"task-count",title:"Woorden tellen",taskKind:"text-metrics",dependsOn:["task-clean"],textFrom:"task-clean"},
  ],
};
test("mission plan rejects cycles, unsafe input and unapproved dataflow",()=>{
  assert.doesNotThrow(()=>validateMissionPlan(mission));
  assert.throws(()=>validateMissionPlan({...mission,tasks:[
    {...mission.tasks[0],dependsOn:["task-count"]},mission.tasks[1],
  ]}),/cyclic/);
  assert.throws(()=>validateMissionPlan({...mission,tasks:[
    mission.tasks[0],{...mission.tasks[1],dependsOn:[]},
  ]}),/declared dependency/);
  assert.throws(()=>validateMissionPlan({...mission,tasks:[
    {...mission.tasks[0],input:{text:"x".repeat(12001)}},mission.tasks[1],
  ]}),/invalid task input/);
});
test("two real deterministic workers execute dependent tasks through authorized API and survive restart",async()=>{
  const root=mkdtempSync(join(tmpdir(),"eai-missions-"));
  const witnessDir=mkdtempSync(join(tmpdir(),"eai-mission-witness-"));
  const pair=generateKeyPairSync("ed25519");
  const witness=new SignedFileAnchorWitness(witnessDir,
    pair.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    pair.publicKey.export({format:"pem",type:"spki"}).toString());
  const person="p".repeat(40),system="s".repeat(40),readOnly="r".repeat(40);
  const tokens={
    [person]:{actor:{kind:"person" as const,id:"person:operator"},access:{read:"*" as const,write:[] as string[],audit:true}},
    [system]:{actor:{kind:"system" as const,id:"system:caller"},access:{read:"*" as const,write:[] as string[],audit:true}},
    [readOnly]:{actor:{kind:"person" as const,id:"person:viewer"},access:{read:"*" as const,write:[] as string[]}},
  };
  const pack=JSON.parse(readFileSync(new URL("../packs/sow-demo/pack.json",import.meta.url),"utf8"));
  const config={dir:join(root,"evidence"),operationsDir:join(root,"ops"),pack,tokens,witness};
  let running=makeServer(config);
  const close=()=>new Promise<void>(ok=>running.server.close(()=>ok()));
  try{
    await new Promise<void>(ok=>running.server.listen(0,"127.0.0.1",()=>ok()));
    let base="http://127.0.0.1:"+((running.server.address() as AddressInfo).port);
    const request=(method:string,path:string,token:string|undefined,body?:unknown)=>fetch(base+path,{
      method,headers:{...(token?{Authorization:"Bearer "+token}:{}),...(body?{"Content-Type":"application/json"}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),
    });
    assert.equal((await request("POST","/ops/missions",readOnly,{plan:mission})).status,403);
    assert.equal((await request("POST","/ops/missions",system,{plan:mission})).status,403);
    assert.equal((await request("POST","/ops/events",person,{type:"task.started"})).status,403);
    assert.equal((await request("POST","/ops/events",person,{type:"mission.create",plan:mission})).status,403);
    const created=await request("POST","/ops/missions",person,{plan:mission});
    assert.equal(created.status,201);
    assert.equal((await request("POST","/ops/missions",person,{plan:mission})).status,422);
    const blocked=await(await request("POST","/ops/missions/mission-brief/step",person,{})).json() as any;
    assert.equal(blocked.started.length,0);
    assert.equal(blocked.blocked[0].reason,"search-and-build");
    const ids=[["text-normalize","text-normalize"],["text-metrics","text-metrics"]] as const;
    for(const [id,taskKind] of ids){
      const contract={
        id,version:"1.0.0",name:id,specialization:"Fixed local text transformation",
        taskKinds:[taskKind],inputSchema:{type:"object"},outputSchema:{type:"object"},
        tools:[],requestedPermissions:[],modelPolicy:{preferred:"deterministic"},
        testSuite:"builtin-fixture-v1",stopConditions:["unknown-input"],
      };
      assert.equal((await request("POST","/ops/events",person,{type:"worker.register",contract})).status,201);
      const evaluation=await request("POST","/ops/workers/"+id+"/evaluate",person,{});
      assert.equal(evaluation.status,200);
      const result=await evaluation.json() as any;
      assert.equal(result.passed,true);
      assert.equal(result.numerator,3);
      assert.equal((await request("POST","/ops/events",person,{type:"worker.release",id,evidenceRef:result.evidenceRef})).status,201);
    }
    assert.equal((await request("POST","/ops/missions/mission-brief/step",readOnly,{})).status,403);
    assert.equal((await request("POST","/ops/missions/mission-brief/step",system,{})).status,403);
    const first=await(await request("POST","/ops/missions/mission-brief/step",person,{})).json() as any;
    assert.deepEqual(first.completed,["task-clean"]);
    assert.equal(first.progress.done,1);
    assert.equal(first.progress.ready,1);
    const second=await(await request("POST","/ops/missions/mission-brief/step",person,{})).json() as any;
    assert.deepEqual(second.completed,["task-count"]);
    assert.equal(second.progress.status,"complete");
    const third=await(await request("POST","/ops/missions/mission-brief/step",person,{})).json() as any;
    assert.equal(third.started.length,0);
    const before=await(await request("GET","/ops/missions",person)).json() as any;
    const m=before.missions["mission-brief"];
    assert.equal(m.tasks["task-clean"].run.output.text,"Hallo wereld\nNu");
    assert.equal(m.tasks["task-count"].run.output.words,3);
    assert.equal(m.tasks["task-count"].run.verification,"not-evaluated");
    assert.match(m.tasks["task-clean"].run.inputHash,/^[a-f0-9]{64}$/);
    assert.equal(m.progress.done,2);
    assert.equal((await request("GET","/ops/missions",readOnly)).status,403);
    await close();
    running=makeServer(config);
    await new Promise<void>(ok=>running.server.listen(0,"127.0.0.1",()=>ok()));
    base="http://127.0.0.1:"+((running.server.address() as AddressInfo).port);
    const resumed=await(await request("GET","/ops/missions",person)).json() as any;
    assert.equal(resumed.missions["mission-brief"].progress.status,"complete");
    assert.equal(resumed.missions["mission-brief"].tasks["task-count"].run.output.words,3);
  }finally{
    if(running.server.listening)await close();
    rmSync(root,{recursive:true,force:true});rmSync(witnessDir,{recursive:true,force:true});
  }
});

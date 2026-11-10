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
  const person="p".repeat(40),system="s".repeat(40),readOnly="r".repeat(40),rector="t".repeat(40),limited="q".repeat(40);
  const tokens={
    [person]:{actor:{kind:"person" as const,id:"person:operator"},access:{read:"*" as const,write:[] as string[],audit:true}},
    [system]:{actor:{kind:"system" as const,id:"system:caller"},access:{read:"*" as const,write:[] as string[],audit:true}},
    [readOnly]:{actor:{kind:"person" as const,id:"person:viewer"},access:{read:"*" as const,write:[] as string[]}},
    [rector]:{actor:{kind:"person" as const,id:"person:rector"},access:{read:"*" as const,write:[] as string[],audit:true}},
    [limited]:{actor:{kind:"person" as const,id:"person:limited"},access:{read:["a.fin.016"],write:[] as string[],audit:true}},
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
    const linked={...mission,id:"mission-linked",tasks:[
      {...mission.tasks[0],evidenceAtomIds:["a.fin.016"]},mission.tasks[1],
    ]};
    assert.equal((await request("POST","/ops/missions",person,{plan:linked})).status,201);
    const unauthorized={...linked,id:"mission-private",tasks:[
      {...mission.tasks[0],evidenceAtomIds:["a.fin.017"]},mission.tasks[1],
    ]};
    assert.equal((await request("POST","/ops/missions",person,{plan:unauthorized})).status,403);
    assert.equal((await request("POST","/ops/missions",limited,{plan:unauthorized})).status,403);
    const unknown={...linked,id:"mission-unknown",tasks:[
      {...mission.tasks[0],evidenceAtomIds:["a.unknown.999"]},mission.tasks[1],
    ]};
    assert.equal((await request("POST","/ops/missions",person,{plan:unknown})).status,422);

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
    const secondPlan={...mission,id:"mission-loop",title:"Gecontroleerde loop"};
    assert.equal((await request("POST","/ops/missions",person,{plan:secondPlan})).status,201);
    assert.equal((await request("POST","/ops/missions/mission-loop/pause",system,{})).status,403);
    assert.equal((await request("POST","/ops/missions/mission-loop/pause",person,{})).status,200);
    assert.equal((await request("POST","/ops/missions/mission-loop/step",person,{})).status,422);
    const paused=await(await request("POST","/ops/missions/mission-loop/run",person,{})).json() as any;
    assert.equal(paused.stopReason,"review-required");
    assert.equal(paused.batches.length,0);
    assert.equal((await request("POST","/ops/missions/mission-loop/resume",person,{})).status,200);
    const loop=await(await request("POST","/ops/missions/mission-loop/run",person,{})).json() as any;
    assert.equal(loop.stopReason,"complete");
    assert.equal(loop.batches.length,2);
    assert.equal(loop.progress.done,2);
    const repeated=await(await request("POST","/ops/missions/mission-loop/run",person,{})).json() as any;
    assert.equal(repeated.stopReason,"complete");
    assert.equal(repeated.batches.length,0);
    const before=await(await request("GET","/ops/missions",person)).json() as any;
    assert.equal((await request("GET","/ops/missions/mission-brief/trace",readOnly)).status,403);
    const traced=await request("GET","/ops/missions/mission-brief/trace",person);
    assert.equal(traced.status,200);
    const trace=await traced.json() as any;
    assert.equal(trace.schema,"eai-mission-trace-v1");
    assert.equal(trace.counts.tasks,2);
    assert.equal(trace.counts.attempts,2);
    assert.ok(trace.tasks.every((t:any)=>t.verification==="not-evaluated"));
    assert.equal(trace.tasks[0].attempts[0].status,"completed");
    assert.ok(!JSON.stringify(trace).includes("Hallo wereld\\nNu"));
    assert.equal((await request("GET","/ops/missions/unknown-trace/trace",person)).status,404);
    const m=before.missions["mission-brief"];
    assert.equal(m.tasks["task-clean"].run.output.text,"Hallo wereld\nNu");
    assert.equal(m.tasks["task-count"].run.output.words,3);
    assert.equal(m.tasks["task-count"].run.verification,"not-evaluated");
    assert.match(m.tasks["task-clean"].run.inputHash,/^[a-f0-9]{64}$/);
    assert.equal(m.progress.done,2);
    const instruction="Maak een concept en publiceer pas na akkoord van de rector.";
    const approval="na akkoord van de rector";
    const start=instruction.indexOf(approval);
    const gated={
      id:"mission-external",title:"Publicatie met goedkeuring",
      goal:"Maak een concept; controleer toestemming voor publicatie",
      sourceInstruction:instruction,
      tasks:[{id:"task-external",title:"Externe publicatie",taskKind:"external-publish",
        dependsOn:[],effect:"publish",input:{text:"PUBLICATIE"}}],
      constraints:[{id:"gate-rector",kind:"approval",quote:approval,start,end:start+approval.length,
        taskIds:["task-external"],approverId:"person:rector"}],
    };
    assert.equal((await request("POST","/ops/missions",person,{plan:gated})).status,201);
    const awaiting=await(await request("POST","/ops/missions/mission-external/run",person,{})).json() as any;
    assert.equal(awaiting.stopReason,"blocked");
    assert.equal(awaiting.progress.blockedByConstraints,1);
    const gateUrl="/ops/missions/mission-external/gates/gate-rector/resolve";
    assert.equal((await request("POST",gateUrl,system,{evidenceRef:"record:1"})).status,403);
    assert.equal((await request("POST",gateUrl,person,{evidenceRef:"record:1"})).status,422);
    assert.equal((await request("POST","/ops/events",rector,{type:"mission.gate.resolve",missionId:gated.id,constraintId:"gate-rector",evidenceRef:"record:1"})).status,403);
    assert.equal((await request("POST",gateUrl,rector,{evidenceRef:"record:1"})).status,201);
    assert.equal((await request("POST",gateUrl,rector,{evidenceRef:"record:2"})).status,422);
    const afterGate=await(await request("POST","/ops/missions/mission-external/run",person,{})).json() as any;
    assert.equal(afterGate.stopReason,"blocked");
    assert.equal(afterGate.progress.blockedByConstraints,0);
    assert.equal(afterGate.batches.at(-1).blocked[0].reason,"search-and-build");
    assert.equal(afterGate.progress.done,0);
    assert.equal((await request("GET","/ops/missions",readOnly)).status,403);
    await close();
    running=makeServer(config);
    await new Promise<void>(ok=>running.server.listen(0,"127.0.0.1",()=>ok()));
    base="http://127.0.0.1:"+((running.server.address() as AddressInfo).port);
    const resumed=await(await request("GET","/ops/missions",person)).json() as any;
    assert.equal(resumed.missions["mission-brief"].progress.status,"complete");
    assert.equal(resumed.missions["mission-brief"].tasks["task-count"].run.output.words,3);
    assert.equal(resumed.missions["mission-loop"].progress.done,2);
  }finally{
    if(running.server.listening)await close();
    rmSync(root,{recursive:true,force:true});rmSync(witnessDir,{recursive:true,force:true});
  }
});

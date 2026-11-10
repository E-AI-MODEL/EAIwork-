import {test} from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "../scripts/local-demo.ts";
import {runExecutorOnce,runExecutorBatch} from "../scripts/local-text-executor.ts";
import {validateExecutorIdentities} from "../packages/operations/src/executor-channel.ts";

const plan=(id:string)=>({
  id,title:"Losse tekstprocessen",goal:"Test twee onafhankelijke vaste teksttaken",
  tasks:[
    {id:"task-first",title:"Tekst normaliseren",taskKind:"text-normalize",
      dependsOn:[],input:{text:"  EAIwork   werkt  "}},
    {id:"task-second",title:"Woorden tellen",taskKind:"text-metrics",
      dependsOn:[],input:{text:"Een twee drie"}},
  ],
});
async function harness(){
  const demo=createDemoServer({schedulerIntervalMs:0});
  await new Promise<void>(done=>demo.server.listen(0,"127.0.0.1",done));
  const base="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
  const request=(path:string,body:unknown={},credential=demo.token)=>fetch(base+path,{
    method:"POST",redirect:"error",headers:{"content-type":"application/json",
      authorization:"Bearer "+credential},body:JSON.stringify(body),
  });
  const get=(path:string,credential=demo.token)=>fetch(base+path,{
    headers:{authorization:"Bearer "+credential},
  });
  return {demo,base,request,get};
}
test("separate executor identity cannot read evidence, dashboard operations or choose missions",async()=>{
  const h=await harness();
  try{
    assert.equal((await h.request("/executor/v1/claim")).status,403);
    assert.equal((await h.get("/ops/state",h.demo.workerToken)).status,403);
    assert.equal((await h.get("/ops/queue",h.demo.workerToken)).status,403);
    assert.equal((await h.get("/state",h.demo.workerToken)).status,403);
    assert.equal((await h.request("/executor/v1/claim",{}, "wrong")).status,401);
    assert.equal((await h.request("/executor/v1/claim",{missionId:"mission-demo-repo"},h.demo.workerToken)).status,422);
    assert.equal((await h.request("/executor/v1/claim",{},h.demo.workerToken)).status,204);
    const id="mission-executor-consent";
    assert.equal((await h.request("/ops/missions",{plan:plan(id)})).status,201);
    assert.equal((await h.request("/executor/v1/claim",{},h.demo.workerToken)).status,204);
    assert.equal((await h.request("/ops/missions/"+id+"/automation/start",
      {maxStarts:2,executionMode:"arbitrary"})).status,422);
    assert.equal((await h.request("/ops/missions/"+id+"/automation/start",
      {maxStarts:2,executionMode:"remote-text",executorIds:["executor-local-demo"]})).status,201);
    const first=await h.request("/executor/v1/claim",{},h.demo.workerToken);
    assert.equal(first.status,200);
    const job=await first.json() as any;
    assert.equal(job.protocol,"eai-local-executor-v1");
    assert.equal(job.kind,"text-normalize");
    assert.equal(job.missionId,id);
    assert.deepEqual(job.input,{text:"  EAIwork   werkt  "});
    assert.equal(job.goal,undefined);
    assert.equal(job.sourceInstruction,undefined);
    assert.equal(job.constraints,undefined);
    assert.ok(job.leaseExpiresAt);
    const ref={missionId:job.missionId,taskId:job.taskId,runId:job.runId,leaseId:job.leaseId};
    assert.equal((await h.request("/executor/v1/heartbeat",
      {...ref,ownerId:"evil"},h.demo.workerToken)).status,422);
    const heartbeat=await h.request("/executor/v1/heartbeat",ref,h.demo.workerToken);
    assert.equal(heartbeat.status,200);
    const newExpiry=(await heartbeat.json() as any).expiresAt;
    assert.ok(Date.parse(newExpiry)>Date.parse(job.leaseExpiresAt));
    assert.equal((await h.request("/executor/v1/complete",
      {...ref,output:{text:"EAIwork werkt",changed:true}},h.demo.workerToken)).status,200);
    assert.equal((await h.request("/executor/v1/complete",
      {...ref,output:{text:"EAIwork werkt",changed:true}},h.demo.workerToken)).status,409);
    const result=await runExecutorOnce(h.base,h.demo.workerToken);
    assert.equal(result.status,"completed");
    assert.equal((await runExecutorOnce(h.base,h.demo.workerToken)).status,"idle");
    const state=await(await h.get("/ops/missions")).json() as any;
    assert.equal(state.missions[id].automation.starts,2);
    assert.equal(state.missions[id].tasks["task-first"].status,"done");
    assert.equal(state.missions[id].tasks["task-second"].run.output.words,3);
    assert.equal(state.missions[id].tasks["task-second"].run.verification,"not-evaluated");
    assert.equal((await h.get("/ops/verify")).status,200);
  }finally{await h.demo.close()}
});
test("three concurrent requests can claim at most two independent leased tasks",async()=>{
  const h=await harness();
  try{
    const id="mission-executor-racing";
    assert.equal((await h.request("/ops/missions",{plan:plan(id)})).status,201);
    assert.equal((await h.request("/ops/missions/"+id+"/automation/start",
      {maxStarts:2,executionMode:"remote-text",executorIds:["executor-local-demo"],resumeAfterRestart:false})).status,201);
    const claims=await Promise.all([0,1,2].map(()=>
      h.request("/executor/v1/claim",{},h.demo.workerToken)));
    assert.deepEqual(claims.map(x=>x.status).sort(),[200,200,204]);
    const jobs=await Promise.all(claims.filter(r=>r.status===200).map(r=>r.json())) as any[];
    assert.equal(new Set(jobs.map(x=>x.taskId)).size,2);
    assert.equal(new Set(jobs.map(x=>x.runId)).size,2);
    assert.equal(new Set(jobs.map(x=>x.leaseId)).size,2);
    const states=await(await h.get("/ops/missions")).json() as any;
    assert.equal(states.missions[id].automation.starts,2);
    assert.equal(states.missions[id].tasks["task-first"].status,"running");
    assert.equal(states.missions[id].tasks["task-second"].status,"running");
    assert.equal((await h.request("/executor/v1/claim",{},h.demo.workerToken)).status,204);
  }finally{await h.demo.close()}
});
test("separate operating-system worker process completes a claimed job",async()=>{
  const h=await harness();
  try{
    const id="mission-executor-process";
    assert.equal((await h.request("/ops/missions",{plan:plan(id)})).status,201);
    assert.equal((await h.request("/ops/missions/"+id+"/automation/start",
      {maxStarts:2,executionMode:"remote-text",executorIds:["executor-local-demo"]})).status,201);
    const execute=()=>new Promise<number>((resolve,reject)=>{
      const child=spawn(process.execPath,["scripts/local-text-executor.ts"],{
        cwd:process.cwd(),env:{EAI_EXECUTOR_URL:h.base,
          EAI_EXECUTOR_TOKEN:h.demo.workerToken},
        stdio:["ignore","pipe","pipe"],
      });
      let output="";
      child.stdout.on("data",(chunk:Buffer)=>{output+=chunk.toString("utf8")});
      child.stderr.on("data",()=>{});
      child.once("error",reject);
      child.once("close",(code)=>{assert.equal(output.includes(h.demo.workerToken),false);resolve(code??1)});
    });
    assert.deepEqual(await Promise.all([execute(),execute()]),[0,0]);
    const states=await(await h.get("/ops/missions")).json() as any;
    assert.equal(states.missions[id].tasks["task-first"].run.output.text,"EAIwork werkt");
    assert.equal(states.missions[id].tasks["task-second"].run.output.words,3);
    assert.equal(states.missions[id].automation.starts,2);
    const trace=await(await h.get("/ops/missions/"+id+"/trace")).json() as any;
    assert.equal(trace.counts.attempts,2);
    assert.equal(trace.tasks[0].attempts[0].leaseOwner,"executor-local-demo");
  }finally{await h.demo.close()}
});
test("a blocked task never becomes claimable through the executor protocol",async()=>{
  const h=await harness();
  try{
    const source="Schrijf een tekst, maar verstuur niets.";
    const quote="verstuur niets",start=source.indexOf(quote);
    const p={...plan("mission-executor-blocked"),sourceInstruction:source,
      constraints:[{id:"gate-no-send",kind:"prohibition",quote,start,end:start+quote.length,
        taskIds:["task-first","task-second"]}]};
    assert.equal((await h.request("/ops/missions",{plan:p})).status,201);
    assert.equal((await h.request("/ops/missions/"+p.id+"/automation/start",
      {maxStarts:2,executionMode:"remote-text",executorIds:["executor-local-demo"]})).status,201);
    assert.equal((await h.request("/executor/v1/claim",{},h.demo.workerToken)).status,204);
    const status=await(await h.get("/ops/missions")).json() as any;
    assert.equal(status.missions[p.id].automation.starts,0);
    assert.equal(status.missions[p.id].tasks["task-first"].status,"queued");
  }finally{await h.demo.close()}
});
test("invalid executor identities and privilege-sharing tokens are rejected at setup",()=>{
  const valid={ownerId:"executor-local-test",taskKinds:["text-normalize" as const]};
  assert.throws(()=>validateExecutorIdentities({["a".repeat(32)]:valid},new Set(["a".repeat(32)])),
    /invalid or shared executor token/);
  assert.throws(()=>validateExecutorIdentities({["a".repeat(32)]:{
    ...valid,taskKinds:["repo-search" as any]}},new Set()),/only supports/);
  assert.throws(()=>validateExecutorIdentities({["a".repeat(32)]:valid,["b".repeat(32)]:valid},new Set()),
    /duplicate executor identity/);
});


test("restart reconciliation revokes nonpersistent executor consent without retrying its claim",async()=>{
  const h=await harness();
  try{
    const id="mission-executor-restart";
    assert.equal((await h.request("/ops/missions",{plan:plan(id)})).status,201);
    assert.equal((await h.request("/ops/missions/"+id+"/automation/start",
      {maxStarts:2,executionMode:"remote-text",executorIds:["executor-local-demo"],resumeAfterRestart:false})).status,201);
    const response=await h.request("/executor/v1/claim",{},h.demo.workerToken);
    assert.equal(response.status,200);
    const job=await response.json() as any;
    assert.equal(h.demo.scheduler.recoverInterrupted(),1);
    const m=(await(await h.get("/ops/missions")).json() as any).missions[id];
    assert.equal(m.automation.enabled,false);
    assert.equal(m.automation.stoppedReason,"interrupted");
    assert.equal(m.tasks[job.taskId].status,"running");
    assert.equal(m.tasks[job.taskId].run.lease.id,job.leaseId);
    assert.equal((await h.request("/executor/v1/complete",{
      missionId:id,taskId:job.taskId,runId:job.runId,leaseId:job.leaseId,
      output:{text:"EAIwork werkt",changed:true},
    },h.demo.workerToken)).status,409);
    assert.equal((await h.request("/executor/v1/claim",{},h.demo.workerToken)).status,204);
    const again=(await(await h.get("/ops/missions")).json() as any).missions[id];
    assert.equal(again.automation.starts,1);
  }finally{await h.demo.close()}
});
test("restart reconciliation preserves explicitly resumable active lease without replay",async()=>{
  const h=await harness();
  try{
    const id="mission-executor-allowed-restart";
    assert.equal((await h.request("/ops/missions",{plan:plan(id)})).status,201);
    assert.equal((await h.request("/ops/missions/"+id+"/automation/start",
      {maxStarts:2,executionMode:"remote-text",executorIds:["executor-local-demo"],resumeAfterRestart:true})).status,201);
    const response=await h.request("/executor/v1/claim",{},h.demo.workerToken);
    assert.equal(response.status,200);
    const job=await response.json() as any;
    assert.equal(h.demo.scheduler.recoverInterrupted(),0);
    const before=(await(await h.get("/ops/missions")).json() as any).missions[id];
    assert.equal(before.automation.starts,1);
    assert.equal(before.tasks[job.taskId].status,"running");
    assert.equal((await h.request("/executor/v1/complete",{
      missionId:id,taskId:job.taskId,runId:job.runId,leaseId:job.leaseId,
      output:{text:"EAIwork werkt",changed:true},
    },h.demo.workerToken)).status,200);
    const after=(await(await h.get("/ops/missions")).json() as any).missions[id];
    assert.equal(after.automation.starts,1);
    assert.equal(after.tasks[job.taskId].status,"done");
    assert.equal(after.tasks[job.taskId].attempts?.length??0,0);
  }finally{await h.demo.close()}
});

test("one bounded local executor finishes dependent steps without manual restarts",async()=>{
  const h=await harness();
  try{
    const id="mission-executor-dependent";
    const dependent={
      id,title:"Onafhankelijke worker met afhankelijke stappen",
      goal:"Gebruik het eerste gecontroleerde resultaat voor de volgende taak",
      tasks:[
        {id:"task-clean",title:"Opschonen",taskKind:"text-normalize",dependsOn:[],
          input:{text:"  Een  twee   drie  "}},
        {id:"task-count",title:"Tellen",taskKind:"text-metrics",
          dependsOn:["task-clean"],textFrom:"task-clean"},
      ],
    };
    assert.equal((await h.request("/ops/missions",{plan:dependent})).status,201);
    assert.equal((await h.request("/ops/missions/"+id+"/automation/start",
      {maxStarts:2,executionMode:"remote-text",executorIds:["executor-local-demo"]})).status,201);
    const inactive=h.demo.scheduler.tick();
    assert.equal(inactive.started,0,"local scheduler must not consume remote consent");
    const summary=await runExecutorBatch(h.base,h.demo.workerToken,{maxTasks:2});
    assert.deepEqual(summary,{completed:2,idleChecks:0});
    const m=(await(await h.get("/ops/missions")).json() as any).missions[id];
    assert.equal(m.tasks["task-clean"].run.output.text,"Een twee drie");
    assert.equal(m.tasks["task-count"].run.output.words,3);
    assert.equal(m.automation.starts,2);
    assert.equal((await runExecutorOnce(h.base,h.demo.workerToken)).status,"idle");
    await assert.rejects(runExecutorBatch(h.base,h.demo.workerToken,{maxTasks:9}),
      /limits must be small/);
    assert.equal((await h.get("/ops/verify")).status,200);
  }finally{await h.demo.close()}
});


test("one standalone worker process can finish two dependent jobs within an explicit bound",async()=>{
  const h=await harness();
  try{
    const id="mission-executor-child-chain";
    const dependent={
      id,title:"Tekst met afhankelijke vervolgtaak",
      goal:"Een los proces verwerkt twee goedgekeurde stappen",
      tasks:[
        {id:"task-clean",title:"Opschonen",taskKind:"text-normalize",dependsOn:[],
          input:{text:"  Dit   werkt  "}},
        {id:"task-count",title:"Tellen",taskKind:"text-metrics",dependsOn:["task-clean"],
          textFrom:"task-clean"},
      ],
    };
    assert.equal((await h.request("/ops/missions",{plan:dependent})).status,201);
    assert.equal((await h.request("/ops/missions/"+id+"/automation/start",
      {maxStarts:2,executionMode:"remote-text",executorIds:["executor-local-demo"]})).status,201);
    const exit=await new Promise<number>((resolve,reject)=>{
      const child=spawn(process.execPath,["scripts/local-text-executor.ts","--max-tasks=2"],{
        cwd:process.cwd(),env:{EAI_EXECUTOR_URL:h.base,
          EAI_EXECUTOR_TOKEN:h.demo.workerToken},
        stdio:["ignore","pipe","pipe"],
      });
      let output="";
      child.stdout.on("data",(chunk:Buffer)=>{output+=chunk.toString("utf8")});
      child.stderr.on("data",()=>{});
      child.once("error",reject);
      child.once("close",(code)=>{
        assert.ok(output.includes("2 teksttaak/taken afgerond"));
        assert.equal(output.includes(h.demo.workerToken),false);
        resolve(code??1);
      });
    });
    assert.equal(exit,0);
    const result=(await(await h.get("/ops/missions")).json() as any).missions[id];
    assert.equal(result.tasks["task-clean"].status,"done");
    assert.equal(result.tasks["task-count"].status,"done");
    assert.equal(result.tasks["task-count"].run.output.words,2);
    assert.equal(result.automation.starts,2);
  }finally{await h.demo.close()}
});
test("remote-text consent refuses a mission requiring repository or external workers",async()=>{
  const h=await harness();
  try{
    const id="mission-executor-unsafe-kind";
    const unsafe={
      id,title:"Niet toegestane adapter",goal:"Blokkeer speciale workers",
      tasks:[{id:"task-unsafe",title:"Repositoryzoekactie",taskKind:"repo-search",
        dependsOn:[],input:{text:"worker"}}],
    };
    assert.equal((await h.request("/ops/missions",{plan:unsafe})).status,201);
    assert.equal((await h.request("/ops/missions/"+id+"/automation/start",
      {maxStarts:2,executionMode:"remote-text",executorIds:["executor-local-demo"]})).status,422);
    const state=(await(await h.get("/ops/missions")).json() as any).missions[id];
    assert.equal(state.automation,undefined);
    assert.equal((await h.request("/executor/v1/claim",{},h.demo.workerToken)).status,204);
  }finally{await h.demo.close()}
});

test("an invalid remote result is durably recorded as failure and cannot be silently retried",async()=>{
  const h=await harness();
  try{
    const id="mission-executor-rejected-result";
    const one={
      id,title:"Mislukt workerantwoord",goal:"Schrijf fout op zonder inhoud te accepteren",
      tasks:[{id:"task-normalize",title:"Normaliseer",taskKind:"text-normalize",
        dependsOn:[],input:{text:"  Gecontroleerde  tekst  "}}],
    };
    assert.equal((await h.request("/ops/missions",{plan:one})).status,201);
    assert.equal((await h.request("/ops/missions/"+id+"/automation/start",
      {maxStarts:1,executionMode:"remote-text",executorIds:["executor-local-demo"]})).status,201);
    const response=await h.request("/executor/v1/claim",{},h.demo.workerToken);
    assert.equal(response.status,200);
    const job=await response.json() as any;
    const ref={missionId:job.missionId,taskId:job.taskId,
      runId:job.runId,leaseId:job.leaseId};
    assert.equal((await h.request("/executor/v1/complete",
      {...ref,output:{text:"vervalst",changed:true}},h.demo.workerToken)).status,409);
    const state=(await(await h.get("/ops/missions")).json() as any).missions[id];
    assert.equal(state.tasks["task-normalize"].status,"failed");
    assert.equal(state.tasks["task-normalize"].run.errorCode,"output-invalid");
    assert.equal(state.tasks["task-normalize"].run.output,undefined);
    assert.equal(state.automation.starts,1);
    assert.equal((await h.request("/executor/v1/complete",
      {...ref,output:{text:"Gecontroleerde tekst",changed:true}},h.demo.workerToken)).status,409);
    assert.equal((await h.request("/executor/v1/claim",{},h.demo.workerToken)).status,204);
    const trace=await(await h.get("/ops/missions/"+id+"/trace")).json() as any;
    assert.equal(trace.tasks[0].attempts[0].status,"failed");
    assert.equal(trace.tasks[0].attempts[0].errorCode,"output-invalid");
  }finally{await h.demo.close()}
});

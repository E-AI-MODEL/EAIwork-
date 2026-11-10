import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {OpsStore} from "../packages/operations/src/store.ts";
import {applyOps,emptyOps,stageOps,type OpsEnvelope} from "../packages/operations/src/registry.ts";

const actor={kind:"person" as const,id:"person:growth-test"};
const envelope=(n:number):OpsEnvelope=>({
  id:"growth-"+n,
  at:"2026-11-10T08:00:00Z",
  actor,
  event:{type:"mission.create",plan:{
    id:"mission-growth-"+n,title:"Groeitest",goal:"Controleer herstel met veel gebeurtenissen",
    tasks:[{id:"task-local",title:"Tekst",taskKind:"text-normalize",
      dependsOn:[],input:{text:"Hallo"}}],
  }},
});
const fixture=()=>{
  const dir=mkdtempSync(join(tmpdir(),"eai-growth-"));
  return {dir,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
};

test("staging preserves the previous history and only commits one event after durable write",()=>{
  const initial=applyOps(emptyOps(),envelope(1));
  const before=structuredClone(initial);
  const staged=stageOps(initial,envelope(2),new Set(["growth-1"]));
  assert.equal(initial.history.length,1);
  assert.equal(staged.history.length,1);
  assert.ok(staged.missions["mission-growth-2"]);
  assert.equal(initial.missions["mission-growth-2"],undefined);
  assert.deepEqual(initial,before);
  const dir=fixture();
  try{
    const store=new OpsStore(dir.dir);
    store.append(envelope(1));
    store.append(envelope(2));
    assert.equal(store.snapshot().history.length,2);
    assert.equal(store.snapshot().history[1].id,"growth-2");
    assert.equal(store.verify().ok,true);
    store.close();
  }finally{dir.cleanup()}
});

test("failed writes are never reflected in the operations state and do not poison a valid journal",()=>{
  const dir=fixture();
  try{
    let store=new OpsStore(dir.dir);
    store.append(envelope(1));
    assert.throws(()=>store.append(envelope(1)),/duplicate event id/);
    assert.throws(()=>store.append({...envelope(2),event:{type:"mission.pause",missionId:"missing"}}),/unknown mission/);
    assert.equal(store.snapshot().history.length,1);
    assert.equal(store.snapshot().missions["mission-growth-2"],undefined);
    store.append(envelope(2));
    assert.equal(store.snapshot().history.length,2);
    store.close();
    store=new OpsStore(dir.dir);
    assert.throws(()=>store.append(envelope(2)),/duplicate event id/);
    store.append(envelope(3));
    assert.equal(store.verify().entries,3);
    store.close();
  }finally{dir.cleanup()}
});

test("local claim is recorded before execution; a second start and a stale completion are rejected",()=>{
  const dir=fixture();
  try{
    const store=new OpsStore(dir.dir);
    store.append(envelope(1));
    const started={
      id:"start-first",at:"2026-11-10T08:00:00Z",
      actor:{kind:"system" as const,id:"system:mission-runner"},
      event:{type:"task.started" as const,missionId:"mission-growth-1",taskId:"task-local",
        run:{runId:"run-local-01",workerId:"text-normalize",workerVersion:"1.0.0",
          adapterId:"text-normalize",inputHash:"a".repeat(64),
          startedAt:"2026-11-10T08:00:00Z",verification:"not-evaluated" as const}},
    };
    store.append(started);
    assert.throws(()=>store.append({...started,id:"start-duplicate",
      event:{...started.event,run:{...started.event.run,runId:"run-local-02"}}}),/already started/);
    assert.throws(()=>store.append({id:"stale-end",at:"2026-11-10T08:00:01Z",
      actor:started.actor,event:{type:"task.completed",missionId:"mission-growth-1",
        taskId:"task-local",runId:"run-local-02",finishedAt:"2026-11-10T08:00:01Z",
        elapsedMs:1,output:{text:"Hallo"},outputHash:"b".repeat(64)}}),/stale task result/);
    assert.equal(store.snapshot().history.length,2);
    assert.equal(store.snapshot().missions["mission-growth-1"].tasks["task-local"].status,"running");
    store.close();
    const reopened=new OpsStore(dir.dir);
    assert.throws(()=>reopened.append({...started,id:"after-restart",
      event:{...started.event,run:{...started.event.run,runId:"run-local-03"}}}),/already started/);
    assert.equal(reopened.snapshot().history.length,2);
    assert.equal(reopened.verify().ok,true);
    reopened.close();
  }finally{dir.cleanup()}
});

test("replaying a longer journal preserves every ID and remains consistent with the pure reducer",()=>{
  const dir=fixture();
  try{
    let store=new OpsStore(dir.dir);
    let expected=emptyOps();
    const count=160;
    for(let n=1;n<=count;n++){
      const item=envelope(n);
      store.append(item);
      expected=applyOps(expected,item);
    }
    assert.deepEqual(store.snapshot(),expected);
    store.close();
    store=new OpsStore(dir.dir);
    assert.equal(store.snapshot().history.length,count);
    assert.deepEqual(store.snapshot(),expected);
    assert.equal(store.verify().entries,count);
    assert.throws(()=>store.append(envelope(1)),/duplicate event id/);
    store.close();
  }finally{dir.cleanup()}
});


test("worker and quality transitions do not mutate a previous staged state",()=>{
  const worker={
    id:"worker-growth",version:"1.0.0",name:"Growth worker",specialization:"Local deterministic check",
    taskKinds:["text-normalize"],inputSchema:{type:"object"},outputSchema:{type:"object"},
    tools:[],requestedPermissions:[],modelPolicy:{preferred:"deterministic" as const},
    testSuite:"builtin-fixture-v1",stopConditions:["invalid-input"],
  };
  const item:OpsEnvelope={id:"registered-growth",at:"2026-11-10T08:00:00Z",actor,
    event:{type:"worker.register",contract:worker}};
  const initial=emptyOps();
  const registered=stageOps(initial,item,new Set());
  assert.equal(initial.workers[worker.id],undefined);
  assert.ok(registered.workers[worker.id]);
  registered.history.push(structuredClone(item));
  const measured:OpsEnvelope={
    id:"quality-growth",at:"2026-11-10T08:00:00Z",
    actor:{kind:"check",id:"check:builtins"},
    event:{type:"quality.record",measurement:{
      id:"growth-metric",workerId:worker.id,version:"1.0.0",taskKind:"text-normalize",
      dataset:"builtin-fixture-v1",suiteVersion:"builtin-fixture-v1",cohort:"fixed-fixtures",
      metric:"fixture-pass",numerator:3,denominator:3,
      measuredAt:"2026-11-10T08:00:00Z",evidenceRef:"fixture:growth",
    }},
  };
  const measurements=stageOps(registered,measured,new Set([item.id]));
  assert.equal(registered.measurements.length,0);
  assert.equal(measurements.measurements.length,1);
  measurements.history.push(structuredClone(measured));
  const release:OpsEnvelope={id:"release-growth",at:"2026-11-10T08:00:00Z",actor,
    event:{type:"worker.release",id:worker.id,evidenceRef:"fixture:growth"}};
  const ready=stageOps(measurements,release,new Set([item.id,measured.id]));
  assert.equal(ready.workers[worker.id].stage,"ready");
  assert.equal(measurements.workers[worker.id].stage,"candidate");
  assert.equal(ready.measurements.length,1);
});

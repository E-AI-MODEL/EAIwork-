/**
 * Reproducible operations growth diagnostic. No pass/fail speed threshold.
 *
 * Compares the old public immutable reducer with the new internal staged
 * reducer on identical valid events, then measures fsync-backed journal
 * writes and a fresh verified replay. Timings are environment-specific.
 */
import {performance} from "node:perf_hooks";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {applyOps,emptyOps,stageOps,type OpsEnvelope,type OpsState} from "../packages/operations/src/registry.ts";
import {OpsStore} from "../packages/operations/src/store.ts";

function countsFromArgs():number[]{
  const flag=process.argv.find(x=>x.startsWith("--counts="));
  const raw=flag?.slice("--counts=".length)??"100,250,500";
  const values=raw.split(",").map(Number);
  if(values.length<1||values.length>5||
     values.some(x=>!Number.isSafeInteger(x)||x<20||x>2000)||
     new Set(values).size!==values.length)
    throw new Error("use --counts=100,250,500 with 1-5 distinct values of 20-2000");
  return values;
}
function task(n:number):OpsEnvelope{
  return {
    id:"growth-event-"+n,at:"2026-11-10T09:00:00Z",
    actor:{kind:"person",id:"person:growth-measurement"},
    event:{type:"mission.create",plan:{
      id:"mission-growth-"+n,title:"Groeitest",
      goal:"Meet eventopslag zonder externe workers",
      tasks:[{id:"task-text",title:"Tekst opschonen",taskKind:"text-normalize",
        dependsOn:[],input:{text:"  Voorbeeld  "}}],
    }},
  };
}
const round=(ms:number)=>Math.round(ms*100)/100;
const checksum=(state:OpsState,n:number):void=>{
  if(state.history.length!==n||Object.keys(state.missions).length!==n||
     state.history.at(-1)?.id!=="growth-event-"+n)
    throw new Error("benchmark correctness check failed at "+n);
};
function compare(n:number){
  const events=Array.from({length:n},(_,index)=>task(index+1));
  let old=emptyOps();
  const t0=performance.now();
  for(const event of events)old=applyOps(old,event);
  const pureMs=round(performance.now()-t0);
  checksum(old,n);

  let staged=emptyOps();
  const ids=new Set<string>();
  const t1=performance.now();
  for(const event of events){
    const next=stageOps(staged,event,ids);
    next.history.push(structuredClone(event));
    ids.add(event.id);
    staged=next;
  }
  const stagedMs=round(performance.now()-t1);
  checksum(staged,n);
  if(JSON.stringify(old)!==JSON.stringify(staged))
    throw new Error("staged and pure reducer disagree");
  const dir=mkdtempSync(join(tmpdir(),"eaiwork-growth-"));
  try{
    let store=new OpsStore(dir);
    const appendStart=performance.now();
    for(const event of events)store.append(event);
    const appendMs=round(performance.now()-appendStart);
    checksum(store.snapshot(),n);
    store.close();
    const reopenStart=performance.now();
    store=new OpsStore(dir);
    const replayMs=round(performance.now()-reopenStart);
    checksum(store.snapshot(),n);
    const verifyStart=performance.now();
    if(!store.verify().ok)throw new Error("journal verification failed");
    const verifyMs=round(performance.now()-verifyStart);
    store.close();
    return {
      events:n,pureReducerMs:pureMs,stagedReducerMs:stagedMs,
      durableAppendMs:appendMs,verifiedReopenMs:replayMs,verifyMs,
      heapUsedBytes:process.memoryUsage().heapUsed,
    };
  }finally{rmSync(dir,{recursive:true,force:true})}
}
const counts=countsFromArgs();
const rows=counts.map(compare);
console.log(JSON.stringify({
  experiment:"eaiwork-operations-growth-v1",
  status:"measured",
  node:process.version,
  platform:process.platform,
  arch:process.arch,
  filesystem:"temporary local filesystem; fsync on every journal event",
  comparison:"identical synthetic mission.create events; reducer timings exclude disk",
  limits:"not a distributed queue test; no production load; no causal benchmark claim",
  rows,
},null,2));

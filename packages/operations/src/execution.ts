/**
 * An intentionally tiny, real execution layer for reviewed deterministic jobs.
 * It cannot access the network, filesystem, shell or user-provided code.
 * Provider-backed, asynchronous worker pools are NOT enabled here.
 */
import { createHash, randomUUID } from "node:crypto";
import type { OpsStore } from "./store.ts";
import { selectWorker, type RuntimeInventory } from "./selector.ts";
import { missionProgress, type MissionRecord } from "./missions.ts";
import type { OpsEvent } from "./registry.ts";

export interface LocalAdapter {
  id:string;
  taskKind:string;
  run(input:{text:string}):Record<string,unknown>;
}
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalize = (input:{text:string}) => {
  const text=input.text.normalize("NFC").replace(/\r\n?/g,"\n").replace(/[ \t]+/g," ").trim();
  return {text,changed:text!==input.text};
};
const metrics=(input:{text:string})=>({
  text:input.text,
  characters:[...input.text].length,
  words:input.text.trim()?input.text.trim().split(/\s+/u).length:0,
  lines:input.text?input.text.split("\n").length:0,
});
const BUILTINS:Readonly<Record<string,LocalAdapter>> = Object.freeze({
  "text-normalize":{id:"text-normalize",taskKind:"text-normalize",run:normalize},
  "text-metrics":{id:"text-metrics",taskKind:"text-metrics",run:metrics},
});
export function builtinInventory():RuntimeInventory {
  return {
    adapterIds:Object.keys(BUILTINS),
    capabilities:[],
    grantedPermissions:[],
    supportedModelSizes:["deterministic"],
  };
}
const fail=(s:string):never=>{throw new Error(s)};
function inputFor(mission:MissionRecord,taskId:string):{text:string} {
  const task=mission.tasks[taskId];
  if(task.spec.input)return structuredClone(task.spec.input);
  const source=mission.tasks[task.spec.textFrom??""];
  if(!source || source.status!=="done" || !source.run?.output ||
     typeof source.run.output.text!=="string")fail("upstream text output unavailable");
  if(source.run.output.text.length>12000)fail("upstream text too long");
  return {text:source.run.output.text};
}
export interface StepResult {
  missionId:string;
  started:string[];
  completed:string[];
  failed:string[];
  blocked:{taskId:string;reason:string}[];
  progress:ReturnType<typeof missionProgress>;
  note:string;
}
export function runMissionStep(store:OpsStore,missionId:string,maximum=4):StepResult {
  if(!Number.isInteger(maximum)||maximum<1||maximum>4)fail("maximum must be 1-4");
  const state=store.snapshot();
  const mission=state.missions[missionId];
  if(!mission)fail("unknown mission");
  if(mission.paused)fail("mission paused");
  const ready=mission.plan.tasks.filter(spec=>
    mission.tasks[spec.id].status==="queued" &&
    spec.dependsOn.every(dep=>mission.tasks[dep].status==="done"));
  const selected=ready.slice(0,maximum);
  const result:StepResult={
    missionId,started:[],completed:[],failed:[],blocked:[],
    progress:missionProgress(mission),note:"Only locally implemented deterministic adapters are executed. Semantic accuracy is not independently checked.",
  };
  const emit=(event:OpsEvent)=>{
    store.append({id:"ops-"+randomUUID(),at:new Date().toISOString(),
      actor:{kind:"system",id:"system:mission-runner"},event});
  };
  for(const spec of selected){
    const current=store.snapshot();
    const now=current.missions[missionId];
    if(now.paused){result.blocked.push({taskId:spec.id,reason:"mission-paused"});break}
    let payload:{text:string};
    try{payload=inputFor(now,spec.id)}catch{
      result.blocked.push({taskId:spec.id,reason:"dependency-output-unavailable"});continue;
    }
    const choice=selectWorker({taskKind:spec.taskKind},current,builtinInventory());
    const id=choice.selectedWorkerId;
    if(!id){result.blocked.push({taskId:spec.id,reason:choice.nextStep});continue}
    const worker=current.workers[id];
    const adapter=BUILTINS[id];
    if(!worker || !adapter || adapter.taskKind!==spec.taskKind || worker.stage!=="ready"){
      result.blocked.push({taskId:spec.id,reason:"worker-unavailable"});continue;
    }
    // Local built-ins only. Never execute an arbitrary adapter from a contract.
    const runId="run-"+randomUUID();
    const started=new Date().toISOString();
    emit({type:"task.started",missionId,taskId:spec.id,run:{
      runId,workerId:id,workerVersion:worker.contract.version,adapterId:adapter.id,
      inputHash:digest(payload),startedAt:started,verification:"not-evaluated",
    }});
    result.started.push(spec.id);
    const begin=performance.now();
    try{
      const output=adapter.run(structuredClone(payload));
      const outputSize=JSON.stringify(output).length;
      if(outputSize>16384)fail("adapter output too large");
      const newer=store.snapshot();
      if(newer.workers[id]?.stage!=="ready"||newer.missions[missionId]?.paused)fail("worker or mission changed during run");
      emit({type:"task.completed",missionId,taskId:spec.id,runId,finishedAt:new Date().toISOString(),
        elapsedMs:Math.round(performance.now()-begin),output,outputHash:digest(output)});
      result.completed.push(spec.id);
    }catch(err){
      emit({type:"task.failed",missionId,taskId:spec.id,runId,finishedAt:new Date().toISOString(),
        elapsedMs:Math.round(performance.now()-begin),
        errorCode:String(err).includes("output")?"output-invalid":"adapter-error"});
      result.failed.push(spec.id);
    }
  }
  result.progress=missionProgress(store.snapshot().missions[missionId]);
  return result;
}

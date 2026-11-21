/**
 * An intentionally tiny, real execution layer for reviewed deterministic jobs.
 * It cannot access the network, filesystem, shell or user-provided code.
 * Provider-backed, asynchronous worker pools are NOT enabled here.
 */
import { createHash, randomUUID } from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {searchLocalRepository} from "./reposearch.ts";
import {BUILTINS,safeComposition,composed,runPureTextAdapter,evaluateComposedFixture} from "./pure-text.ts";
import type { OpsStore } from "./store.ts";
import { selectWorker, type RuntimeInventory } from "./selector.ts";
import { blockingConstraints, missionProgress, type MissionRecord } from "./missions.ts";
import type { OpsEvent, OpsState } from "./registry.ts";

export {runPureTextAdapter} from "./pure-text.ts";
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function evaluateBuiltin(id:string,contract:{
  id:string;version:string;taskKinds:string[];testSuite:string;
  modelPolicy:{preferred:string};tools:string[];requestedPermissions:string[];
  recipe?:{kind:string;steps:string[]};
}) {
  if(contract.recipe){
    if(id!==contract.id||!safeComposition(contract))throw new Error("untrusted fixed worker recipe");
    return evaluateComposedFixture(contract as import("./registry.ts").WorkerContract);
  }
  if(id==="repo-search"){
    if(contract.id!=="repo-search"||!contract.taskKinds.includes("repo-search") ||
       contract.testSuite!=="repo-search-fixture-v1"||
       contract.modelPolicy.preferred!=="deterministic"||
       JSON.stringify(contract.tools)!==JSON.stringify(["repo.search"])||
       JSON.stringify(contract.requestedPermissions)!==JSON.stringify(["read:repo"]))
      throw new Error("no trusted repository search fixture suite for this contract");
    const root=mkdtempSync(join(tmpdir(),"eai-reposearch-fixtures-"));
    try{
      mkdirSync(join(root,"src"));
      writeFileSync(join(root,"src","fixture.ts"),"// verified worker candidate\n");
      const matched=searchLocalRepository(root,"verified worker");
      const empty=searchLocalRepository(root,"not-present");
      let rejected=false;
      try{searchLocalRepository(root,"\n")}catch{rejected=true}
      const checks=[
        matched.results.length===1&&matched.results[0].path==="src/fixture.ts",
        empty.results.length===0,
        rejected,
      ];
      return {numerator:checks.filter(Boolean).length,denominator:checks.length,
        metric:"fixture-pass",taskKind:"repo-search",dataset:"repo-search-fixture-v1",
        suiteVersion:"repo-search-fixture-v1",cohort:"fixed-fixtures",
        note:"Fixed local read-only fixture. Source hits are not a code-quality or licence certification."};
    }finally{rmSync(root,{recursive:true,force:true})}
  }
  const adapter=BUILTINS[id];
  if(!adapter||contract.id!==id||!contract.taskKinds.includes(adapter.taskKind)||
     contract.modelPolicy.preferred!=="deterministic" ||
     contract.testSuite!=="builtin-fixture-v1" ||
     contract.tools.length||contract.requestedPermissions.length)
     throw new Error("no trusted fixture suite for this exact contract");
  const fixtures=id==="text-normalize"?[
    {input:{text:"  Hallo  wereld\r\n"},expected:{text:"Hallo wereld",changed:true}},
    {input:{text:"Al goed"},expected:{text:"Al goed",changed:false}},
    {input:{text:"\tA  B\t"},expected:{text:"A B",changed:true}},
  ]:id==="reference-extract"?[
    {input:{text:"Lees [de bron](https://example.org/pad)."},
      expected:{text:"Lees [de bron](https://example.org/pad).",
        references:[{label:"de bron",url:"https://example.org/pad"}],
        detected:1,truncated:false,review:"links-not-verified"}},
    {input:{text:"Geen verwijzingen"},
      expected:{text:"Geen verwijzingen",references:[],
        detected:0,truncated:false,review:"links-not-verified"}},
    {input:{text:"[Niet geldig](javascript:alert)"},
      expected:{text:"[Niet geldig](javascript:alert)",references:[],
        detected:0,truncated:false,review:"links-not-verified"}},
  ]:[
    {input:{text:"Hallo wereld\nNu"},expected:{text:"Hallo wereld\nNu",characters:15,words:3,lines:2}},
    {input:{text:""},expected:{text:"",characters:0,words:0,lines:0}},
    {input:{text:"Een"},expected:{text:"Een",characters:3,words:1,lines:1}},
  ];
  const results=fixtures.map(f=>({
    passed:JSON.stringify(adapter.run(structuredClone(f.input)))===JSON.stringify(f.expected),
  }));
  return {numerator:results.filter(r=>r.passed).length,denominator:results.length,
    metric:"fixture-pass",taskKind:adapter.taskKind,
    dataset:"builtin-fixture-v1",suiteVersion:"builtin-fixture-v1",cohort:"fixed-fixtures",
    note:"Closed deterministic test cases only; not a general-purpose accuracy measurement."};
}
export function builtinInventory(repoSearchRoot?:string,composedIds:string[]=[]):RuntimeInventory {
  return {
      adapterIds:[...Object.keys(BUILTINS),...(repoSearchRoot?["repo-search"]:[]),...composedIds],
    capabilities:repoSearchRoot?["repo.search"]:[],
    grantedPermissions:repoSearchRoot?["read:repo"]:[],
    supportedModelSizes:["deterministic"],
  };
}
/** The same runtime inventory is used for execution and advisory preflight. */
export function builtinInventoryForState(state:OpsState,repoSearchRoot?:string):RuntimeInventory {
  const composedIds=Object.values(state.workers)
    .filter(w=>safeComposition(w.contract)).map(w=>w.contract.id);
  return builtinInventory(repoSearchRoot,composedIds);
}
const fail=(s:string):never=>{throw new Error(s)};
/** Read a bounded input from an already-approved mission dependency. */
export function inputFor(mission:MissionRecord,taskId:string):{text:string} {
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
export function runMissionStep(store:OpsStore,missionId:string,maximum=4,repoSearchRoot?:string):StepResult {
  if(!Number.isInteger(maximum)||maximum<1||maximum>4)fail("maximum must be 1-4");
  const state=store.snapshot();
  const mission=state.missions[missionId];
  if(!mission)fail("unknown mission");
  if(mission.plan.executionPreference==="cloud")fail("cloud-designated mission cannot run on the local executor");
  if(mission.paused)fail("mission paused");
  const ready=mission.plan.tasks.filter(spec=>
    mission.tasks[spec.id].status==="queued" &&
    spec.dependsOn.every(dep=>mission.tasks[dep].status==="done") &&
    blockingConstraints(mission,spec.id).length===0);
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
    const choice=selectWorker({taskKind:spec.taskKind},current,
      builtinInventoryForState(current,repoSearchRoot));
    const id=choice.selectedWorkerId;
    if(!id){result.blocked.push({taskId:spec.id,reason:choice.nextStep});continue}
    const worker=current.workers[id];
    const adapter:LocalAdapter|undefined=id==="repo-search"&&repoSearchRoot?
      {id:"repo-search",taskKind:"repo-search",run:(input)=>{
        const search=searchLocalRepository(repoSearchRoot,input.text,{maxFiles:500,maxResults:5});
        return {text:"RepoSearch: "+search.results.length+" bronfragmenten gevonden; inhoud nog niet beoordeeld.",
          revision:search.revision,rootLabel:search.rootLabel,
          visitedFiles:search.visitedFiles,truncated:search.truncated,results:search.results};
      }}:worker?.contract.recipe&&safeComposition(worker.contract)?
        {id,taskKind:"text-inspect",run:composed}:BUILTINS[id];
    if(!worker || !adapter || adapter.taskKind!==spec.taskKind || worker.stage!=="ready"){
      result.blocked.push({taskId:spec.id,reason:"worker-unavailable"});continue;
    }
    try {
      const fixture=evaluateBuiltin(id,worker.contract);
      if(fixture.numerator!==fixture.denominator)throw new Error("fixed suite failed");
    }catch{
      result.blocked.push({taskId:spec.id,reason:"untrusted-worker-contract"});continue;
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

/**
 * A bounded synchronous loop for explicit local execution. This is not a
 * persistent background scheduler. Each batch is committed before the next.
 */
export function runMissionUntilBlocked(store:OpsStore,missionId:string,maxBatches=32,repoSearchRoot?:string){
  if(!Number.isInteger(maxBatches)||maxBatches<1||maxBatches>32)throw new Error("invalid batch limit");
  const batches:StepResult[]=[];
  let stopReason:"complete"|"blocked"|"review-required"|"batch-limit"="batch-limit";
  for(let n=0;n<maxBatches;n++){
    const m=store.snapshot().missions[missionId];
    if(!m)throw new Error("unknown mission");
    const before=missionProgress(m);
    if(before.status==="complete"){stopReason="complete";break}
    if(before.status==="needs-review"||before.status==="paused"){stopReason="review-required";break}
    if(!before.ready){stopReason="blocked";break}
    const batch=runMissionStep(store,missionId,4,repoSearchRoot);
    batches.push(batch);
    if(batch.failed.length){stopReason="review-required";break}
    if(!batch.started.length){stopReason="blocked";break}
    if(batch.progress.status==="complete"){stopReason="complete";break}
  }
  return {missionId,batches,stopReason,progress:missionProgress(store.snapshot().missions[missionId]),
    note:"Synchronous, bounded, local-only execution. No external tools, AI model calls, or background job."};
}

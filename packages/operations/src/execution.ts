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
import type { OpsStore } from "./store.ts";
import { selectWorker, type RuntimeInventory } from "./selector.ts";
import { blockingConstraints, missionProgress, type MissionRecord } from "./missions.ts";
import type { OpsEvent, OpsState } from "./registry.ts";

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
const composed=(input:{text:string})=>{
  const cleaned=normalize(input);
  return {...metrics({text:cleaned.text}),changed:cleaned.changed};
};
const safeComposition=(contract:{recipe?:{kind:string;steps:string[]};taskKinds:string[];
  modelPolicy:{preferred:string};testSuite:string;tools:string[];requestedPermissions:string[]})=>
  contract.recipe?.kind==="builtin-compose" &&
  JSON.stringify(contract.recipe.steps)===JSON.stringify(["text-normalize","text-metrics"]) &&
  JSON.stringify(contract.taskKinds)===JSON.stringify(["text-inspect"]) &&
  contract.modelPolicy.preferred==="deterministic" &&
  contract.testSuite==="builtin-compose-fixture-v1" &&
  contract.tools.length===0 && contract.requestedPermissions.length===0;
/** Inspect Markdown links without fetching content or asserting source quality. */
const referenceExtract=(input:{text:string})=>{
  const references:Array<{label:string;url:string}>=[];
  let detected=0;
  const pattern=/\[([^\]\r\n]{1,80})\]\((https?:\/\/[^\s)<>]{1,260})\)/g;
  for(const match of input.text.matchAll(pattern)){
    try{
      const url=new URL(match[2]);
      if(!["http:","https:"].includes(url.protocol)||url.username||url.password)continue;
      detected++;
      if(references.length<8)references.push({label:match[1],url:match[2]});
    }catch{continue}
  }
  return {text:input.text,references,detected,truncated:detected>references.length,
    review:"links-not-verified"};
};
const BUILTINS:Readonly<Record<string,LocalAdapter>> = Object.freeze({
  "text-normalize":{id:"text-normalize",taskKind:"text-normalize",run:normalize},
  "text-metrics":{id:"text-metrics",taskKind:"text-metrics",run:metrics},
  "reference-extract":{id:"reference-extract",taskKind:"reference-extract",run:referenceExtract},
});
/** Four explicitly fixed, side-effect-free text tasks, no dynamic scripts or tools. */
export function runPureTextAdapter(kind:string,input:{text:string}):Record<string,unknown>{
  if(!["text-normalize","text-metrics","text-inspect","reference-extract"].includes(kind)||
     !input||typeof input.text!=="string"||input.text.length>12000)
    throw new Error("unsupported pure text input or adapter");
  return kind==="text-inspect" ? composed(structuredClone(input)) :
    BUILTINS[kind].run(structuredClone(input));
}
export function evaluateBuiltin(id:string,contract:{
  id:string;version:string;taskKinds:string[];testSuite:string;
  modelPolicy:{preferred:string};tools:string[];requestedPermissions:string[];
  recipe?:{kind:string;steps:string[]};
}) {
  if(contract.recipe){
    if(id!==contract.id||!safeComposition(contract))throw new Error("untrusted fixed worker recipe");
    const cases=[
      {input:{text:"  Hallo  wereld\r\n"},expected:{text:"Hallo wereld",characters:12,words:2,lines:1,changed:true}},
      {input:{text:"Een\nTwee"},expected:{text:"Een\nTwee",characters:8,words:2,lines:2,changed:false}},
      {input:{text:""},expected:{text:"",characters:0,words:0,lines:0,changed:false}},
    ];
    const passed=cases.filter(x=>JSON.stringify(composed(x.input))===JSON.stringify(x.expected)).length;
    return {numerator:passed,denominator:cases.length,metric:"fixture-pass",taskKind:"text-inspect",
      dataset:"builtin-compose-fixture-v1",suiteVersion:"builtin-compose-fixture-v1",
      cohort:"fixed-fixtures",note:"Only this fixed two-step recipe has been tested."};
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

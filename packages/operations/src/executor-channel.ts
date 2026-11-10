/**
 * Single-writer coordinator for a separate, trusted local executor process.
 * A bearer identity is resolved by the server, NEVER supplied by a worker.
 * No arbitrary code, model access, repository access or external writes.
 */
import {createHash,randomUUID} from "node:crypto";
import type {OpsStore} from "./store.ts";
import {blockingConstraints} from "./missions.ts";
import {selectWorker} from "./selector.ts";
import {builtinInventoryForState,evaluateBuiltin,inputFor,runPureTextAdapter} from "./execution.ts";
import type {OpsEvent,OpsState} from "./registry.ts";

export type FixedTextKind="text-normalize"|"text-metrics"|"text-inspect"|"reference-extract";
export interface ExecutorIdentity {
  ownerId:string;
  taskKinds:FixedTextKind[];
}
export interface ExecutorJob {
  protocol:"eai-local-executor-v1";
  missionId:string;taskId:string;kind:FixedTextKind;
  runId:string;leaseId:string;leaseExpiresAt:string;
  input:{text:string};
}
/** Each permitted task kind resolves to one fixed, server-tested worker ID. */
const WORKER_ID:Readonly<Record<FixedTextKind,string>>=Object.freeze({
  "text-normalize":"text-normalize",
  "text-metrics":"text-metrics",
  "text-inspect":"text-inspector",
  "reference-extract":"reference-extract",
});
const FIXED:ReadonlySet<string>=new Set(Object.keys(WORKER_ID));
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const nowIso=()=>new Date().toISOString();
const fail=(message:string):never=>{throw new Error(message)};
const emit=(store:OpsStore,event:OpsEvent,at=nowIso())=>
  store.append({id:"ops-"+randomUUID(),at,
    actor:{kind:"system",id:"system:mission-runner"},event});
const admitted=(state:OpsState,kind:FixedTextKind):{version:string;workerId:string}|null=>{
  const workerId=WORKER_ID[kind];
  const candidate=selectWorker({taskKind:kind},state,builtinInventoryForState(state));
  if(candidate.selectedWorkerId!==workerId)return null;
  const record=state.workers[workerId],contract=record?.contract;
  if(!contract||record.stage!=="ready"||
     contract.taskKinds.length!==1||contract.taskKinds[0]!==kind)return null;
  try{
    const checked=evaluateBuiltin(workerId,contract);
    if(checked.taskKind!==kind||checked.numerator!==checked.denominator)return null;
  }catch{return null}
  return {workerId,version:contract.version};
};
export function validateExecutorIdentities(
  tokens:Record<string,ExecutorIdentity>|undefined,
  existingTokens:ReadonlySet<string>,
):void{
  if(!tokens)return;
  const owners=new Set<string>();
  for(const [token,identity] of Object.entries(tokens)){
    if(token.length<32||/^(REPLACE_|dev-token-)/.test(token)||
       existingTokens.has(token))
      fail("invalid or shared executor token");
    if(!identity||typeof identity.ownerId!=="string"||
       !/^executor-[a-z0-9-]{3,55}$/.test(identity.ownerId)||
       owners.has(identity.ownerId))
      fail("invalid or duplicate executor identity");
    owners.add(identity.ownerId);
    if(!Array.isArray(identity.taskKinds)||identity.taskKinds.length<1||
       identity.taskKinds.length>4||identity.taskKinds.some(k=>!FIXED.has(k))||
       new Set(identity.taskKinds).size!==identity.taskKinds.length)
      fail("executor only supports four known local text adapters");
  }
}

/** Read the most recent durable lease start for a mission, including reviewed attempts. */
const lastLeaseClaimMs=(mission:OpsState["missions"][string]):number=>{
  let last=0;
  for(const record of Object.values(mission.tasks)){
    for(const run of [...(record.attempts??[]),...(record.run?[record.run]:[])]){
      if(!run.lease)continue;
      const at=Date.parse(run.startedAt);
      if(Number.isFinite(at))last=Math.max(last,at);
    }
  }
  return last;
};
/** Server-side claim is durable before input is ever returned to the caller. */
export function claimTextJob(store:OpsStore,executor:ExecutorIdentity):ExecutorJob|null{
  const state=store.snapshot();
  const active=Object.values(state.missions).reduce((n,m)=>n+
    Object.values(m.tasks).filter(t=>t.status==="running"&&!!t.run?.lease).length,0);
  if(active>=2)return null;
  // Spread work between eligible missions: the mission that has waited
  // longest since its last durable lease gets the next open slot. Ties
  // retain stable ID ordering. No separate mutable queue cursor is stored.
  const missions=Object.values(state.missions).sort((a,b)=>
    lastLeaseClaimMs(a)-lastLeaseClaimMs(b) ||
    a.plan.id.localeCompare(b.plan.id));
  for(const mission of missions){
    const consent=mission.automation;
    if(mission.paused||!consent?.enabled||consent.executionMode!=="remote-text"||
       !consent.executorIds?.includes(executor.ownerId)||
       consent.starts>=consent.maxStarts||
       Object.values(mission.tasks).some(t=>t.status==="failed"))
      continue;
    for(const spec of mission.plan.tasks){
      if(!executor.taskKinds.includes(spec.taskKind as FixedTextKind)||
         !FIXED.has(spec.taskKind)||spec.effect&&spec.effect!=="local")
        continue;
      const task=mission.tasks[spec.id];
      if(task?.status!=="queued"||
         spec.dependsOn.some(dep=>mission.tasks[dep].status!=="done")||
         blockingConstraints(mission,spec.id).length)continue;
      const entry=admitted(state,spec.taskKind as FixedTextKind);
      if(!entry)continue;
      let input:{text:string};
      try{input=inputFor(mission,spec.id)}
      catch{continue}
      if(input.text.length>12000||Buffer.byteLength(JSON.stringify(input),"utf8")>13000)
        continue;
      const startedAt=nowIso();
      const runId="run-"+randomUUID(),leaseId="lease-"+randomUUID();
      const leaseExpiresAt=new Date(Date.parse(startedAt)+15000).toISOString();
      emit(store,{type:"task.lease.claim",missionId:mission.plan.id,taskId:spec.id,
        leaseId,ownerId:executor.ownerId,expiresAt:leaseExpiresAt,
        run:{runId,workerId:entry.workerId,workerVersion:entry.version,
          adapterId:spec.taskKind,inputHash:digest(input),startedAt,
          verification:"not-evaluated"}},startedAt);
      return {protocol:"eai-local-executor-v1",missionId:mission.plan.id,
        taskId:spec.id,kind:spec.taskKind as FixedTextKind,
        runId,leaseId,leaseExpiresAt,input};
    }
  }
  return null;
}
export interface JobReference {
  missionId:string;taskId:string;runId:string;leaseId:string;
}
export function validateJobReference(value:unknown):asserts value is JobReference {
  if(!value||typeof value!=="object"||Array.isArray(value))
    fail("invalid executor request");
  const v=value as Record<string,unknown>;
  for(const key of ["missionId","taskId","runId","leaseId"]){
    if(typeof v[key]!=="string"||!(/^[a-z][a-z0-9-]{2,63}$/.test(v[key] as string)))
      fail("invalid executor reference");
  }
}
const activeClaim=(store:OpsStore,identity:ExecutorIdentity,ref:JobReference)=>{
  const state=store.snapshot();
  const mission=state.missions[ref.missionId],task=mission?.tasks[ref.taskId];
  const lease=task?.run?.lease;
  if(!mission||!task||task.status!=="running"||!lease||
     task.run?.runId!==ref.runId||lease.id!==ref.leaseId||
     lease.ownerId!==identity.ownerId||
     mission.paused||!mission.automation?.enabled||
     mission.automation.executionMode!=="remote-text"||
     !mission.automation.executorIds?.includes(identity.ownerId)||
     !identity.taskKinds.includes(task.spec.taskKind as FixedTextKind)||
     !FIXED.has(task.spec.taskKind))
    fail("executor claim no longer active");
  if(Date.now()>=Date.parse(lease.expiresAt))fail("executor lease has expired");
  const admittedWorker=admitted(state,task.spec.taskKind as FixedTextKind);
  if(!admittedWorker||admittedWorker.version!==task.run.workerVersion||
     admittedWorker.workerId!==task.run.workerId||
     task.run.adapterId!==task.spec.taskKind)
    fail("executor worker no longer admitted");
  return {mission,task,lease};
};
export function heartbeatTextJob(store:OpsStore,identity:ExecutorIdentity,ref:JobReference){
  const {lease}=activeClaim(store,identity,ref);
  if(lease.renewals>=20)fail("executor lease renewal limit reached");
  const now=nowIso(),expiresAt=new Date(Date.parse(now)+15000).toISOString();
  emit(store,{type:"task.lease.renew",...ref,ownerId:identity.ownerId,expiresAt},now);
  return {expiresAt};
}
export function completeTextJob(
  store:OpsStore,identity:ExecutorIdentity,
  ref:JobReference & {output:Record<string,unknown>},
):{status:"completed";runId:string}{
  const {task,mission}=activeClaim(store,identity,ref);
  if(!ref.output||typeof ref.output!=="object"||Array.isArray(ref.output)||
     JSON.stringify(ref.output).length>16384)fail("invalid executor result");
  const input=inputFor(mission,ref.taskId);
  if(digest(input)!==task.run!.inputHash)fail("executor source input changed");
  const expected=runPureTextAdapter(task.spec.taskKind,input);
  const finishedAt=nowIso();
  const elapsedMs=Math.max(0,Date.parse(finishedAt)-Date.parse(task.run!.startedAt));
  if(JSON.stringify(ref.output)!==JSON.stringify(expected)){
    // Keep the mismatch visible in the event log without retaining the
    // untrusted worker output. Human review is required before a retry.
    emit(store,{type:"task.failed",...ref,finishedAt,elapsedMs,
      errorCode:"output-invalid"},finishedAt);
    fail("executor output failed independent deterministic verification");
  }
  emit(store,{type:"task.completed",...ref,finishedAt,elapsedMs,
    output:expected,outputHash:digest(expected)},finishedAt);
  return {status:"completed",runId:ref.runId};
}

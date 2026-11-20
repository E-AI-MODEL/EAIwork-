/**
 * Vacancy -> existing Builder -> trusted fixture -> human release.
 *
 * This is NOT a second scheduler or a general code-generating agent.
 * Only the currently supported fixed text-inspection recipe can be built.
 * The approved mission remains queued until a person releases the worker.
 */
import {randomUUID} from "node:crypto";
import type {OpsStore} from "./store.ts";
import type {OpsState,OpsEvent} from "./registry.ts";
import {selectWorker} from "./selector.ts";
import {builtinInventoryForState,evaluateBuiltin} from "./execution.ts";
import {blockingConstraints} from "./missions.ts";
import {proposeComposedWorker} from "./builder.ts";

export type WorkerNeedStatus =
  "available"|"buildable"|"awaiting-test"|"awaiting-release"|
  "worker-unavailable"|"unsupported"|"condition-blocked"|"external-action";
export interface WorkerNeed {
  taskId:string;
  taskKind:string;
  status:WorkerNeedStatus;
  workerId:string|null;
  evidenceRef?:string;
  reason:string;
}
export interface MissionWorkerNeeds {
  missionId:string;
  revision:number;
  status:"ready"|"complete"|"stopped";
  canPrepare:boolean;
  needs:WorkerNeed[];
}

/** Only trusted, exact-version builtin evaluation may authorize human release. */
function trustedFixture(state:OpsState,id:string,version:string):string|undefined {
  const w=state.workerVersions[id]?.[version];
  if(!w)return undefined;
  const row=[...state.history].reverse().find(entry=>{
    const e=entry.event;
    if(entry.actor.kind!=="check"||entry.actor.id!=="check:builtins"||
       e.type!=="quality.record")return false;
    const m=e.measurement;
    return m.workerId===id&&m.version===version&&m.suiteVersion===w.contract.testSuite&&
      m.metric==="fixture-pass"&&m.numerator===m.denominator&&m.denominator>=3&&
      m.cohort==="fixed-fixtures";
  });
  return row?.event.type==="quality.record"?row.event.measurement.evidenceRef:undefined;
}

/** Pure, input-free overview. Never exposes task text, secrets or model prompts. */
export function inspectMissionWorkerNeeds(
  state:OpsState,missionId:string,repoSearchRoot?:string,
):MissionWorkerNeeds {
  const m=state.missions[missionId];
  if(!m)throw new Error("unknown mission");
  const tasks=Object.values(m.tasks);
  if(tasks.every(t=>t.status==="done"))
    return {missionId,revision:m.revision,status:"complete",canPrepare:false,needs:[]};
  if(m.paused||m.automation?.enabled||tasks.some(t=>t.status==="running"||t.status==="failed"))
    return {missionId,revision:m.revision,status:"stopped",canPrepare:false,needs:[]};
  const inventory=builtinInventoryForState(state,repoSearchRoot);
  const needs:WorkerNeed[]=[];
  for(const task of m.plan.tasks) {
    if(m.tasks[task.id]?.status!=="queued"||
       !task.dependsOn.every(d=>m.tasks[d]?.status==="done"))continue;
    const row=(status:WorkerNeedStatus,workerId:string|null,reason:string,evidenceRef?:string)=>
      needs.push({taskId:task.id,taskKind:task.taskKind,status,workerId,reason,
        ...(evidenceRef?{evidenceRef}:{})});
    if(blockingConstraints(m,task.id).length){row("condition-blocked",null,"Open voorwaarde; niet bouwen of uitvoeren");continue}
    if(task.effect!==undefined&&task.effect!=="local"){row("external-action",null,"Externe actie vraagt afzonderlijk mandaat");continue}
    const selection=selectWorker({taskKind:task.taskKind},state,inventory);
    if(selection.selectedWorkerId){row("available",selection.selectedWorkerId,"Vrijgegeven worker beschikbaar");continue}
    const existing=Object.values(state.workers).find(w=>w.contract.taskKinds.includes(task.taskKind));
    if(existing){
      if(existing.stage==="candidate"){
        const evidenceRef=trustedFixture(state,existing.contract.id,existing.contract.version);
        row(evidenceRef?"awaiting-release":"awaiting-test",existing.contract.id,
          evidenceRef?"Test vastgelegd; menselijke toelating vereist":"Kandidaat moet eerst getest worden",evidenceRef);
      }else{
        row("worker-unavailable",existing.contract.id,
          "Worker bestaat, maar is niet uitvoerbaar of is geblokkeerd; geen tweede worker maken");
      }
      continue;
    }
    if(task.taskKind==="text-inspect"&&!state.workers["text-inspector"]){
      row("buildable","text-inspector","Bestaande Builder kan twee vertrouwde lokale tekstbewerkingen combineren");
    }else{
      row("unsupported",null,"Geen geteste Builder-receptuur voor deze taaksoort");
    }
  }
  return {missionId,revision:m.revision,status:"ready",
    canPrepare:needs.some(v=>v.status==="buildable"),needs};
}
export interface PreparedWorker {
  status:"candidate-tested"|"no-buildable-vacancy";
  missionId:string;
  revision:number;
  taskId?:string;
  workerId?:string;
  version?:string;
  evidenceRef?:string;
  passed?:boolean;
  approvalRequired:true;
  note:string;
}

/** Exactly one trusted candidate and fixture per explicitly requested call. */
export function prepareMissingWorker(
  store:OpsStore,missionId:string,options:{requestedBy:string;expectedRevision:number;taskId:string;repoSearchRoot?:string},
):PreparedWorker {
  if(store.verify().ok!==true)throw new Error("operations journal verification failed");
  const current=store.snapshot();
  const mission=current.missions[missionId];
  if(!mission)throw new Error("unknown mission");
  if(!options.requestedBy.startsWith("person:")||mission.createdBy!==options.requestedBy)
    throw new Error("only mission owner may prepare workers");
  if(!Number.isSafeInteger(options.expectedRevision)||options.expectedRevision!==mission.revision)
    throw new Error("stale mission revision");
  if(typeof options.taskId!=="string"||!options.taskId.trim())
    throw new Error("task id required");
  const inspection=inspectMissionWorkerNeeds(current,missionId,options.repoSearchRoot);
  const vacancy=inspection.needs.find(v=>v.taskId===options.taskId);
  if(!vacancy||vacancy.status!=="buildable")
    throw new Error("no approved, supported worker vacancy for task");
  // The build recipe is fixed and can never run model-supplied code.
  const proposal=proposeComposedWorker("text-inspector","Tekstinspectie");
  if(vacancy.taskKind!=="text-inspect"||proposal.contract.taskKinds.join(",")!==vacancy.taskKind||
     proposal.contract.tools.length||proposal.contract.requestedPermissions.length)
    throw new Error("worker recipe not allowed");
  const check=evaluateBuiltin(proposal.contract.id,proposal.contract);
  if(check.numerator!==check.denominator||check.denominator<3)
    throw new Error("worker fixture did not pass");
  const emit=(event:OpsEvent,kind:"person"|"check")=>
    store.append({id:"ops-"+randomUUID(),at:new Date().toISOString(),
      actor:kind==="person"?{kind:"person",id:options.requestedBy}:{kind:"check",id:"check:builtins"},event});
  emit({type:"worker.register",contract:proposal.contract},"person");
  const evidenceRef="builtin-fixtures:"+randomUUID();
  emit({type:"quality.record",measurement:{
    id:"measurement-"+randomUUID(),workerId:proposal.contract.id,version:proposal.contract.version,
    taskKind:check.taskKind,dataset:check.dataset,suiteVersion:check.suiteVersion,
    cohort:check.cohort,metric:check.metric,numerator:check.numerator,denominator:check.denominator,
    measuredAt:new Date().toISOString(),evidenceRef,
  }},"check");
  return {status:"candidate-tested",missionId,revision:mission.revision,taskId:options.taskId,
    workerId:proposal.contract.id,version:proposal.contract.version,evidenceRef,passed:true,
    approvalRequired:true,
    note:"Kandidaat samengesteld en lokaal getest. Worker blijft candidate; alleen een persoon kan via bestaande worker.release-route toelaten. Missie blijft ongewijzigd."};
}

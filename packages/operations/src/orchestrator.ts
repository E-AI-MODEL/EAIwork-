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
import {builtinInventoryForState,evaluateBuiltin} from "./execution.ts";
import {proposeComposedWorker} from "./builder.ts";
import {inspectMissionWorkerNeedsWithInventory,type MissionWorkerNeeds} from "./worker-needs.ts";

export {type WorkerNeedStatus,type WorkerNeed,type MissionWorkerNeeds} from "./worker-needs.ts";
export function inspectMissionWorkerNeeds(
  state:OpsState,missionId:string,repoSearchRoot?:string,
):MissionWorkerNeeds {
  return inspectMissionWorkerNeedsWithInventory(
    state,missionId,builtinInventoryForState(state,repoSearchRoot));
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
  if(typeof options.requestedBy!=="string"||!options.requestedBy.trim()||
     mission.createdBy!==options.requestedBy)
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

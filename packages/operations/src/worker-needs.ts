/**
 * Shared pure orchestration: eligible workers, tested candidates and blocked
 * requests. Used unchanged by the Node orchestrator and Cloudflare dashboard.
 * Runtime inventory is supplied by the trusted host, never by a model or UI.
 */
import type {OpsState} from "./registry.ts";
import {selectWorker,type RuntimeInventory} from "./selector.ts";
import {blockingConstraints} from "./missions.ts";

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
export function inspectMissionWorkerNeedsWithInventory(
  state:OpsState,missionId:string,inventory:RuntimeInventory,
):MissionWorkerNeeds {
  const m=state.missions[missionId];
  if(!m)throw new Error("unknown mission");
  const tasks=Object.values(m.tasks);
  if(tasks.every(t=>t.status==="done"))
    return {missionId,revision:m.revision,status:"complete",canPrepare:false,needs:[]};
  if(m.paused||m.automation?.enabled||tasks.some(t=>t.status==="running"||t.status==="failed"))
    return {missionId,revision:m.revision,status:"stopped",canPrepare:false,needs:[]};
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
    }else if(task.taskKind==="csv-dashboard"&&!state.workers["csv-dashboard-renderer"]){
      row("buildable","csv-dashboard-renderer","Bestaande Builder kan vaste CSV-parser en HTML-renderer samenstellen en testen");
    }else{
      row("unsupported",null,"Geen geteste Builder-receptuur voor deze taaksoort");
    }
  }
  return {missionId,revision:m.revision,status:"ready",
    canPrepare:needs.some(v=>v.status==="buildable"),needs};
}

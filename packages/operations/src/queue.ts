/**
 * Read-only projection of the persisted mission queue and claimed local jobs.
 * Task inputs and results never leave this projection. No extra queue state
 * can diverge from the verified operations journal.
 */
import {blockingConstraints,type MissionTaskRecord} from "./missions.ts";
import type {OpsState} from "./registry.ts";

export type QueueRow={
  missionId:string;taskId:string;kind:string;
  status:"ready"|"waiting"|"blocked"|"leased"|"lease-expired"|"running"|"done"|"needs-review";
  phaseId:string|null;
  dependsOn:string[];
  runId:string|null;
  leaseId:string|null;
  leaseOwner:string|null;
  leaseExpiresAt:string|null;
  blockers:string[];
};
const sortRows=(a:QueueRow,b:QueueRow)=>
  a.missionId.localeCompare(b.missionId)||a.taskId.localeCompare(b.taskId);
const statusOf=(task:MissionTaskRecord,paused:boolean,blocked:string[],nowMs:number):QueueRow["status"]=>{
  if(task.status==="done")return "done";
  if(task.status==="failed")return "needs-review";
  if(task.status==="running"){
    const expiry=task.run?.lease?.expiresAt;
    return expiry&&Date.parse(expiry)<=nowMs?"lease-expired":
      expiry?"leased":"running";
  }
  if(paused||blocked.length)return "blocked";
  return "ready";
};
export function projectLocalQueue(state:OpsState,nowMs=Date.now()){
  if(!Number.isFinite(nowMs)||nowMs<0)throw new Error("invalid queue inspection time");
  const rows:QueueRow[]=[];
  for(const [missionId,mission] of Object.entries(state.missions)){
    const phaseByTask=new Map<string,string>();
    for(const phase of mission.plan.phases??[])
      for(const id of phase.taskIds)phaseByTask.set(id,phase.id);
    for(const task of mission.plan.tasks){
      const record=mission.tasks[task.id];
      const blockers:string[]=[];
      if(mission.paused)blockers.push("mission-paused");
      if(mission.automation?.enabled)blockers.push("automatic-mode");
      if(record.status==="queued"){
        if(task.dependsOn.some(id=>mission.tasks[id].status!=="done"))
          blockers.push("unfinished-dependency");
        for(const c of blockingConstraints(mission,task.id))
          blockers.push("constraint:"+c.id);
      }
      const approved=record.status==="queued" &&
        !blockers.length &&
        ["text-normalize","text-metrics","text-inspect","reference-extract"].includes(task.taskKind) &&
        (task.effect===undefined||task.effect==="local");
      const run=record.run;
      const lease=run?.lease;
      let status:QueueRow["status"]=statusOf(record,mission.paused,blockers,nowMs);
      if(status==="ready"&&!approved){
        blockers.push("not-a-claimable-local-worker");
        status="blocked";
      }
      rows.push({
        missionId,taskId:task.id,kind:task.taskKind,status,
        phaseId:phaseByTask.get(task.id)??null,
        dependsOn:[...task.dependsOn],
        runId:run?.runId??null,leaseId:lease?.id??null,
        leaseOwner:lease?.ownerId??null,leaseExpiresAt:lease?.expiresAt??null,
        blockers,
      });
    }
  }
  rows.sort(sortRows);
  const counts={
    ready:rows.filter(r=>r.status==="ready").length,
    leased:rows.filter(r=>r.status==="leased").length,
    expired:rows.filter(r=>r.status==="lease-expired").length,
    waiting:rows.filter(r=>r.status==="blocked").length,
    running:rows.filter(r=>r.status==="running").length,
    completed:rows.filter(r=>r.status==="done").length,
    needsReview:rows.filter(r=>r.status==="needs-review").length,
  };
  return {schema:"eai-local-queue-v1",asOf:new Date(nowMs).toISOString(),
    scope:"single-writer-local-queue",autoDispatch:false,
    counts,rows,note:"Queue derived from committed journal. Claimable means structurally ready, not proof of successful execution or permission for external effects."};
}

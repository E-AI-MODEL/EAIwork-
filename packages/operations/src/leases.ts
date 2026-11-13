/**
 * Recover lease state using the one trusted, exclusive operations writer.
 * This does NOT reschedule a task, transfer the lease, grant credentials or
 * use a remote worker. It records expiry so a human can review a retry.
 */
import {randomUUID} from "node:crypto";
import type {OpsStore} from "./store.ts";
import type {OpsState} from "./registry.ts";

export function expiredLocalLeases(state:OpsState,nowMs:number):Array<{
  missionId:string;taskId:string;runId:string;leaseId:string
}>{
  if(!Number.isFinite(nowMs)||nowMs<0)throw new Error("invalid lease inspection time");
  const expired:Array<{missionId:string;taskId:string;runId:string;leaseId:string}>=[];
  for(const [missionId,mission] of Object.entries(state.missions)){
    for(const [taskId,task] of Object.entries(mission.tasks)){
      const lease=task.run?.lease;
      if(task.status!=="running"||!task.run||!lease)continue;
      if(!["text-normalize","text-metrics"].includes(task.spec.taskKind)||
         (task.spec.effect!==undefined&&task.spec.effect!=="local"))
        throw new Error("unknown leased task requires manual review");
      const expiry=Date.parse(lease.expiresAt);
      if(!Number.isFinite(expiry))throw new Error("invalid lease expiry in journal");
      if(expiry<=nowMs)expired.push({
        missionId,taskId,runId:task.run.runId,leaseId:lease.id,
      });
    }
  }
  return expired;
}
export function expireLocalLeases(store:OpsStore,now=new Date()):number {
  const nowMs=now.getTime();
  if(!Number.isFinite(nowMs))throw new Error("invalid lease expiration time");
  const pending=expiredLocalLeases(store.snapshot(),nowMs);
  for(const item of pending){
    // Re-evaluate current state before every write. The claim must still
    // match: no expiry event may affect a subsequent, newly owned attempt.
    const current=store.snapshot().missions[item.missionId]?.tasks[item.taskId];
    if(current?.status!=="running"||current.run?.runId!==item.runId||
       current.run.lease?.id!==item.leaseId)continue;
    store.append({
      id:"ops-"+randomUUID(),at:now.toISOString(),
      actor:{kind:"system",id:"system:mission-runner"},
      event:{type:"task.lease.expire",...item},
    });
  }
  return pending.length;
}

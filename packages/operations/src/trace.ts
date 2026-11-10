/**
 * Read-only mission execution trace. Derived from journal events, not model claims.
 * History includes retries; the mission snapshot alone only keeps the latest run.
 */
import {createHash} from "node:crypto";
import {blockingConstraints,missionProgress} from "./missions.ts";
import type {OpsState} from "./registry.ts";

export function buildMissionTrace(state:OpsState,missionId:string){
  const mission=state.missions[missionId];
  if(!mission)throw new Error("unknown mission");
  const traces=new Map(mission.plan.tasks.map(t=>[t.id,[] as Array<Record<string,unknown>>]));
  const eventRecords:Array<{
    sequence:number;at:string;type:string;actor:{kind:string;id:string};
    taskId?:string;runId?:string;constraintId?:string;reason?:string;
  }>=[];
  let sequence=0;
  for(const envelope of state.history){
    sequence++;
    const e=envelope.event;
    if(!("missionId" in e) || e.missionId!==missionId)continue;
    const row:typeof eventRecords[number]={
      sequence,at:envelope.at,type:e.type,
      actor:{kind:envelope.actor.kind,id:envelope.actor.id},
    };
    if("taskId" in e)row.taskId=e.taskId;
    if(e.type==="task.started"){
      row.runId=e.run.runId;
      traces.get(e.taskId)?.push({
        runId:e.run.runId,workerId:e.run.workerId,workerVersion:e.run.workerVersion,
        adapterId:e.run.adapterId,startedAt:e.run.startedAt,
        inputHash:e.run.inputHash,finishedAt:null,elapsedMs:null,outputHash:null,
        errorCode:null,verification:e.run.verification,
        tokens:null,cost:null,status:"running",
      });
    }
    if(e.type==="task.completed"||e.type==="task.failed"){
      row.runId=e.runId;
      const attempts=traces.get(e.taskId)??[];
      const run=attempts.find(a=>a.runId===e.runId);
      if(run){
        run.finishedAt=e.finishedAt;run.elapsedMs=e.elapsedMs;
        if(e.type==="task.completed"){
          run.outputHash=e.outputHash;run.status="completed";
        }else{run.errorCode=e.errorCode;run.status="failed";}
      }
    }
    if(e.type==="task.retry")row.reason=e.reason;
    if(e.type==="mission.gate.resolve")row.constraintId=e.constraintId;
    eventRecords.push(row);
  }
  const tasks=mission.plan.tasks.map(spec=>{
    const record=mission.tasks[spec.id];
    const open=blockingConstraints(mission,spec.id).map(g=>({id:g.id,kind:g.kind,quote:g.quote}));
    return {
      id:spec.id,title:spec.title,taskKind:spec.taskKind,
      effect:spec.effect??"local",dependsOn:[...spec.dependsOn],
      evidenceAtomIds:[...(spec.evidenceAtomIds??[])],
      status:record.status,
      blocker:record.status!=="queued"?null:
        open.length?"instruction-constraint":
        spec.dependsOn.some(d=>mission.tasks[d].status!=="done")?"dependency":null,
      constraints:open,
      attempts:traces.get(spec.id)??[],
      latestOutputHash:record.run?.outputHash??null,
      verification:record.run?.verification??"not-evaluated",
    };
  });
  const latestEvents=eventRecords.slice(-1500);
  return {
    schema:"eai-mission-trace-v1",
    mission:{id:mission.plan.id,title:mission.plan.title,goal:mission.plan.goal,
      createdAt:mission.createdAt,createdBy:mission.createdBy,paused:mission.paused,
      sourceInstructionSha256:mission.plan.sourceInstruction?
        createHash("sha256").update(mission.plan.sourceInstruction).digest("hex"):null,
      progress:missionProgress(mission)},
    counts:{tasks:tasks.length,attempts:tasks.reduce((n,t)=>n+t.attempts.length,0),
      events:eventRecords.length,returnedEvents:latestEvents.length},
    tasks,events:latestEvents,eventsTruncated:eventRecords.length>latestEvents.length,
    metricsNote:"Durations are measured. Token use and cost are unknown and shown as null. A technical completion is not proof of correctness.",
  };
}

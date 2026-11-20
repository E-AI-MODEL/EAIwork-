/**
 * EAIwork's own bounded observe -> decide -> act -> check loop.
 *
 * It reuses approved missions, admitted local workers and the existing
 * append-only operations journal. A model may only propose an append-only
 * revision for separate human review; it never authorizes an action.
 */
import type {OpsStore} from "./store.ts";
import {missionProgress,blockingConstraints,type MissionRecord} from "./missions.ts";
import {runMissionStep,type StepResult} from "./execution.ts";
import {proposeMissionRevision,type RevisionProposal} from "./replan.ts";
import type {PlanningModel} from "./planner.ts";

export type AgentStop =
  "complete"|"budget-exhausted"|"blocked"|"needs-review"|"paused"|"in-progress";

export interface AgentObservation {
  kind:"execute"|"stop";
  reason:AgentStop|"ready";
  taskId:string|null;
  progress:ReturnType<typeof missionProgress>;
}

export function observeAgentMission(mission:MissionRecord):AgentObservation {
  const progress=missionProgress(mission);
  const stop=(reason:AgentStop):AgentObservation=>({kind:"stop",reason,taskId:null,progress});
  if(mission.automation?.enabled)return stop("in-progress");
  if(mission.paused)return stop("paused");
  if(progress.status==="complete")return stop("complete");
  if(progress.failed>0)return stop("needs-review");
  if(progress.running>0)return stop("in-progress");
  const next=mission.plan.tasks.find(spec=>
    mission.tasks[spec.id]?.status==="queued" &&
    spec.dependsOn.every(id=>mission.tasks[id]?.status==="done") &&
    blockingConstraints(mission,spec.id).length===0);
  if(!next)return stop(progress.blockedByConstraints?"needs-review":"blocked");
  // The agent never starts any new external effect, including a "local" adapter
  // assigned to an external-write/publish/destructive task.
  if(next.effect!==undefined&&next.effect!=="local")return stop("needs-review");
  return {kind:"execute",reason:"ready",taskId:next.id,progress};
}

export interface AgentCycleOptions {
  /** Authenticated human who approved the existing mission. */
  requestedBy:string;
  /** Each request authorizes at most 1-8 local worker starts. */
  maxStarts?:number;
  /** Server-allowlisted checkout; never a model-supplied path. */
  repoSearchRoot?:string;
  /** An explicit opt-in to request a draft, never to apply that draft. */
  proposeOnBlock?:boolean;
  planningModel?:PlanningModel;
}
export interface AgentCycleResult {
  missionId:string;
  starts:number;
  stopReason:AgentStop;
  decisions:AgentObservation[];
  batches:StepResult[];
  progress:ReturnType<typeof missionProgress>;
  revisionProposal?:RevisionProposal;
  note:string;
}

export async function runAgentCycle(
  store:OpsStore,missionId:string,options:AgentCycleOptions,
):Promise<AgentCycleResult> {
  const maxStarts=options.maxStarts??1;
  if(!Number.isSafeInteger(maxStarts)||maxStarts<1||maxStarts>8)
    throw new Error("agent start limit must be 1-8");
  if(typeof options.requestedBy!=="string"||!options.requestedBy.startsWith("person:"))
    throw new Error("a person must request the agent cycle");
  if(options.proposeOnBlock!==undefined&&typeof options.proposeOnBlock!=="boolean")
    throw new Error("invalid revision preference");
  if(options.proposeOnBlock&&!options.planningModel?.proposeRevision)
    throw new Error("revision model is not configured");
  const initial=store.snapshot().missions[missionId];
  if(!initial)throw new Error("unknown mission");
  if(initial.createdBy!==options.requestedBy)
    throw new Error("only the original mission approver may start the agent");
  const decisions:AgentObservation[]=[];
  const batches:StepResult[]=[];
  let stopReason:AgentStop="budget-exhausted";
  let starts=0;
  while(starts<maxStarts){
    // A corrupt or unavailable journal is never a reason to retry an action.
    if(store.verify().ok!==true)throw new Error("operations journal verification failed");
    const current=store.snapshot().missions[missionId];
    if(!current)throw new Error("mission disappeared");
    if(current.revision!==initial.revision)throw new Error("mission changed during agent cycle");
    const decision=observeAgentMission(current);
    decisions.push(decision);
    if(decision.kind==="stop"){stopReason=decision.reason as AgentStop;break}
    const result=runMissionStep(store,missionId,1,options.repoSearchRoot);
    batches.push(result);
    starts+=result.started.length;
    if(result.failed.length){stopReason="needs-review";break}
    if(result.started.length!==1||result.completed.length!==1){
      stopReason="blocked";break;
    }
    const after=store.snapshot().missions[missionId];
    const finished=after?.tasks[decision.taskId!];
    // Actual completion, output hash and journal integrity must be recorded
    // by the trusted runner, not merely reported by a model.
    if(finished?.status!=="done"||!finished.run?.outputHash||store.verify().ok!==true){
      stopReason="needs-review";break;
    }
  }
  const last=store.snapshot().missions[missionId];
  const final=observeAgentMission(last);
  if(final.kind==="stop")stopReason=final.reason as AgentStop;
  const result:AgentCycleResult={
    missionId,starts,stopReason,decisions,batches,progress:missionProgress(last),
    note:"Output is recorded, not semantically verified. No status promotion, external action or automatic approval.",
  };
  // A revision is only offered when local execution is stuck for a reason
  // other than a safety gate, pause, failure or already-running work.
  if(stopReason==="blocked"&&options.proposeOnBlock&&options.planningModel &&
     !last.automation?.enabled&&!last.paused&&
     !Object.values(last.tasks).some(t=>t.status==="failed"||t.status==="running")&&
     missionProgress(last).blockedByConstraints===0){
    result.revisionProposal=await proposeMissionRevision(
      last,options.planningModel,"Geen uitvoerbare lokale worker; stel alleen een controleerbare aanvulling voor.");
    // A model may not mutate the mission or cause a second execution.
    if(store.snapshot().missions[missionId].revision!==initial.revision)
      throw new Error("mission changed while reviewing a model proposal");
  }
  return result;
}

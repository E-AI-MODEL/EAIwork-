/**
 * Model-assisted additions to an existing mission. Suggestions are never
 * accepted as actor authorization or as verification of the source request.
 */
import {createHash} from "node:crypto";
import {validateMissionExtension,type MissionPlan,type MissionRecord} from "./missions.ts";
import type {PlanningModel,ReplanContext} from "./planner.ts";

export interface RevisionProposal {
  missionId:string;
  expectedRevision:number;
  plan:MissionPlan;
  modelId:string;
  sourceSha256:string;
  status:"requires-human-review";
  constraintCoverage:"not-evaluated";
  missingInformation:string[];
  note:string;
}
const plain=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==="object"&&!Array.isArray(x);
export async function proposeMissionRevision(
  mission:MissionRecord,model:PlanningModel,reason:string,
):Promise<RevisionProposal>{
  if(!mission||!model?.proposeRevision)throw new Error("revision planner not configured");
  if(typeof reason!=="string"||!reason.trim()||reason.length>600)
    throw new Error("invalid revision reason");
  if(mission.automation?.enabled || Object.values(mission.tasks).some(t=>t.status==="running"))
    throw new Error("stop running work before requesting a plan revision");
  const old=mission.plan;
  const context:ReplanContext={
    originalInstruction:old.sourceInstruction??null,
    goal:old.goal,
    currentRevision:mission.revision,
    reason,
    existingTasks:old.tasks.map(({id,title,taskKind,dependsOn,effect,textFrom})=>({
      id,title,taskKind,dependsOn,effect:effect??"local",textFrom:textFrom??null,
    })),
    existingPhases:old.phases??null,
    sourceConstraints:old.constraints??[],
  };
  if(JSON.stringify(context).length>16000)
    throw new Error("mission revision context too large for local model");
  const raw=await model.proposeRevision(context);
  if(!plain(raw)||Object.keys(raw).some(k=>
    !["addedTasks","addedPhases","addedConstraints","missingInformation"].includes(k)))
    throw new Error("unsupported revision proposal fields");
  const added=raw.addedTasks;
  if(!Array.isArray(added)||added.length<1||added.length>16)
    throw new Error("revision proposal requires 1-16 additional tasks");
  const extraPhases=raw.addedPhases??[];
  const extraConstraints=raw.addedConstraints??[];
  const missing=raw.missingInformation??[];
  if(!Array.isArray(extraPhases)||extraPhases.length>16||
     !Array.isArray(extraConstraints)||extraConstraints.length>32||
     !Array.isArray(missing)||missing.length>16||
     missing.some(x=>typeof x!=="string"||!x.trim()||x.length>240)||
     new Set(missing).size!==missing.length)
    throw new Error("invalid revision proposal details");
  if(old.phases && extraPhases.length<1)
    throw new Error("existing phased plan requires new phases for appended tasks");
  if(!old.phases && extraPhases.length)
    throw new Error("cannot introduce phases while extending an unphased mission");
  // Validation below verifies every task identifier, effect and dependency.
  const ids=added.map((task:unknown)=>(task as {id?:unknown})?.id);
  if(ids.some(id=>typeof id!=="string")||new Set(ids).size!==ids.length)
    throw new Error("invalid added task ids");
  if(extraConstraints.some((g:unknown)=>!plain(g)||!Array.isArray(g.taskIds)||
     g.taskIds.some((id:unknown)=>!ids.includes(id))))
    throw new Error("new constraints may only target new tasks");
  const constraints=[
    ...(old.constraints??[]).map(g=>({...g,taskIds:[...g.taskIds,...ids as string[]]})),
    ...extraConstraints,
  ];
  const plan:MissionPlan={
    ...old,
    tasks:[...old.tasks,...added],
    ...(old.phases?{phases:[...old.phases,...extraPhases]}:{}),
    constraints,
  };
  // Exact same validator is used again when the human eventually approves.
  validateMissionExtension(mission,plan,mission.revision);
  return {
    missionId:old.id,expectedRevision:mission.revision,plan,modelId:model.id,
    sourceSha256:createHash("sha256").update(old.sourceInstruction??old.goal).digest("hex"),
    status:"requires-human-review",constraintCoverage:"not-evaluated",
    missingInformation:[...missing],
    note:"Only new tasks were proposed. Old tasks, results and source constraints are retained. No task was registered or approved. The proposed interpretation still requires human review.",
  };
}

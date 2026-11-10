/**
 * Approved, dependency-aware mission plans and replayable task transitions.
 * Status describes execution, not epistemic support or independent verification.
 */
export type MissionActor = {kind:"person"|"system"|"check";id:string};
export type TaskEffect = "local" | "external-write" | "publish" | "destructive";
export interface MissionConstraint {
  id:string;
  kind:"prohibition"|"approval"|"condition"|"deadline"|"uncertainty";
  /** Must be an exact, source-located fragment of the approved instruction. */
  quote:string;
  start:number;
  end:number;
  taskIds:string[];
  /** Required only for an approval gate. Match an authenticated actor ID. */
  approverId?:string;
}
export interface GateResolution {by:string;at:string;evidenceRef:string}
export interface MissionTask {
  /** Local tasks have no external side effects; all others need an approval gate. */
  effect?:TaskEffect;
  id:string;
  title:string;
  taskKind:string;
  dependsOn:string[];
  input?:{text:string};
  textFrom?:string;
  /** Existing evidence atoms used as read-only provenance links, not automatic proof. */
  evidenceAtomIds?:string[];
}
export interface MissionPlan {
  /** The original request is preserved unchanged; no model may rewrite it. */
  sourceInstruction?:string;
  constraints?:MissionConstraint[];
  id:string;
  title:string;
  goal:string;
  tasks:MissionTask[];
}
export interface TaskRun {
  runId:string;
  workerId:string;
  workerVersion:string;
  adapterId:string;
  inputHash:string;
  startedAt:string;
  finishedAt?:string;
  elapsedMs?:number;
  output?:Record<string,unknown>;
  outputHash?:string;
  errorCode?:"adapter-error"|"output-invalid"|"worker-unavailable";
  verification:"not-evaluated";
  retryReview?:{by:string;reason:string;at:string};
}
export interface MissionTaskRecord {
  spec:MissionTask;
  status:"queued"|"running"|"done"|"failed";
  run?:TaskRun;
  attempts?:TaskRun[];
}
export type SchedulerStopReason = "complete"|"budget-exhausted"|"blocked"|"needs-review"|"interrupted"|"paused"|"user-stopped";
export interface MissionAutomation {
  enabled:boolean;
  maxStarts:number;
  starts:number;
  approvedBy:string;
  approvedAt:string;
  stoppedReason?:SchedulerStopReason;
  stoppedAt?:string;
}
export interface MissionRecord {
  automation?:MissionAutomation;
  plan:MissionPlan;
  createdAt:string;
  createdBy:string;
  paused:boolean;
  resolvedGates:Record<string,GateResolution>;
  tasks:Record<string,MissionTaskRecord>;
}
export type MissionEvent =
  | {type:"mission.create";plan:MissionPlan}
  | {type:"mission.pause";missionId:string}
  | {type:"mission.resume";missionId:string}
  | {type:"mission.automation.start";missionId:string;maxStarts:number}
  | {type:"mission.automation.stop";missionId:string;reason:SchedulerStopReason}
  | {type:"mission.gate.resolve";missionId:string;constraintId:string;evidenceRef:string}
  | {type:"task.retry";missionId:string;taskId:string;reason:string}
  | {type:"task.started";missionId:string;taskId:string;run:Pick<TaskRun,"runId"|"workerId"|"workerVersion"|"adapterId"|"inputHash"|"startedAt"|"verification">}
  | {type:"task.completed";missionId:string;taskId:string;runId:string;finishedAt:string;elapsedMs:number;output:Record<string,unknown>;outputHash:string}
  | {type:"task.failed";missionId:string;taskId:string;runId:string;finishedAt:string;elapsedMs:number;errorCode:"adapter-error"|"output-invalid"|"worker-unavailable"};
const ID=/^[a-z][a-z0-9-]{2,63}$/;
const fail=(message:string):never=>{throw new Error(message)};
const bounded=(value:unknown,name:string,max=500)=>{
  if(typeof value!=="string"||!value.trim()||value.length>max)fail("invalid "+name);
};
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
export function validateMissionPlan(plan:MissionPlan):void {
  if(!plain(plan)||typeof plan.id!=="string"||!ID.test(plan.id))fail("invalid mission id");
  bounded(plan.title,"mission title",160);bounded(plan.goal,"mission goal",1500);
  if(!Array.isArray(plan.tasks)||plan.tasks.length<1||plan.tasks.length>32)fail("mission must have 1-32 tasks");
  const ids=new Set<string>();
  for(const task of plan.tasks){
    if(!plain(task)||typeof task.id!=="string"||!ID.test(task.id)||ids.has(task.id))fail("invalid or duplicate task id");
    ids.add(task.id);
    bounded(task.title,"task title",160);bounded(task.taskKind,"task kind",100);
    if(task.effect!==undefined && !["local","external-write","publish","destructive"].includes(task.effect))
      fail("invalid task effect");
    if(!Array.isArray(task.dependsOn)||task.dependsOn.length>32||
      !task.dependsOn.every(x=>typeof x==="string"&&ID.test(x))||
      new Set(task.dependsOn).size!==task.dependsOn.length)fail("invalid dependencies");
    if(task.evidenceAtomIds!==undefined && (!Array.isArray(task.evidenceAtomIds) ||
       task.evidenceAtomIds.length>24 ||
       task.evidenceAtomIds.some(id=>typeof id!=="string"||id.length>128||!id.trim()||/[\r\n\0]/.test(id)) ||
       new Set(task.evidenceAtomIds).size!==task.evidenceAtomIds.length))
       fail("invalid evidence links");
    if(task.textFrom!==undefined&&(typeof task.textFrom!=="string"||!ID.test(task.textFrom)))fail("invalid text source");
    if(task.input!==undefined&&(!plain(task.input)||typeof task.input.text!=="string"||task.input.text.length>12000||
       Object.keys(task.input).some(key=>key!=="text")))fail("invalid task input");
    if((task.input===undefined)===(task.textFrom===undefined))fail("exactly one input or textFrom required");
    if(task.textFrom!==undefined&&!task.dependsOn.includes(task.textFrom))fail("textFrom must be a declared dependency");
  }
  const index=new Map(plan.tasks.map(t=>[t.id,t]));
  for(const task of plan.tasks)for(const dep of task.dependsOn)
    if(!index.has(dep)||dep===task.id)fail("unknown or self dependency");
  const constraints=plan.constraints??[];
  if(plan.sourceInstruction!==undefined &&
     (typeof plan.sourceInstruction!=="string"||!plan.sourceInstruction.trim()||plan.sourceInstruction.length>12000))
    fail("invalid source instruction");
  if(!Array.isArray(constraints)||constraints.length>64 ||
     (constraints.length>0 && plan.sourceInstruction===undefined))
    fail("constraints require an original instruction");
  const guardIds=new Set<string>();
  for(const g of constraints){
    if(!plain(g)||typeof g.id!=="string"||!ID.test(g.id)||guardIds.has(g.id))
      fail("invalid or duplicate constraint");
    guardIds.add(g.id);
    if(!["prohibition","approval","condition","deadline","uncertainty"].includes(g.kind))
      fail("invalid constraint kind");
    if(!Array.isArray(g.taskIds)||g.taskIds.length===0||
       new Set(g.taskIds).size!==g.taskIds.length||g.taskIds.some(id=>!ids.has(id)))
      fail("invalid constraint task targets");
    if(typeof g.start!=="number"||typeof g.end!=="number"||
       !Number.isInteger(g.start)||!Number.isInteger(g.end)||
       g.start<0||g.end<=g.start || typeof g.quote!=="string" ||
       plan.sourceInstruction!.slice(g.start,g.end)!==g.quote)
      fail("constraint quote is not anchored to original instruction");
    if(g.kind==="approval"){
      bounded(g.approverId,"required approver",128);
    }else if(g.approverId!==undefined)fail("unexpected approver for non-approval constraint");
  }
  for(const t of plan.tasks){
    if(t.effect && t.effect!=="local" &&
       !constraints.some(g=>g.kind==="approval"&&g.taskIds.includes(t.id)))
      fail("external effects require an explicit source-anchored approval gate");
  }
  const visiting=new Set<string>(),visited=new Set<string>();
  const visit=(id:string):void=>{
    if(visiting.has(id))fail("cyclic dependency");
    if(visited.has(id))return;
    visiting.add(id);
    for(const dep of index.get(id)!.dependsOn)visit(dep);
    visiting.delete(id);visited.add(id);
  };
  for(const task of plan.tasks)visit(task.id);
}
export function applyMissionEvent(missions:Record<string,MissionRecord>,e:MissionEvent,actor:MissionActor,at:string):void {
  if(e.type==="mission.create"){
    if(actor.kind!=="person")fail("a person must approve a mission");
    validateMissionPlan(e.plan);
    if(missions[e.plan.id])fail("duplicate mission");
    missions[e.plan.id]={
      plan:structuredClone(e.plan),createdAt:at,createdBy:actor.id,paused:false,resolvedGates:{},
      tasks:Object.fromEntries(e.plan.tasks.map(t=>[t.id,{spec:structuredClone(t),status:"queued"}])),
    };
    return;
  }
  if(typeof e.missionId!=="string")fail("missing mission");
  const mission=missions[e.missionId];if(!mission)fail("unknown mission");
  if(e.type==="mission.pause"||e.type==="mission.resume"){
    if(actor.kind!=="person")fail("person required to pause or resume");
    mission.paused=e.type==="mission.pause";
    if(e.type==="mission.pause"&&mission.automation?.enabled){
      mission.automation.enabled=false;
      mission.automation.stoppedReason="paused";
      mission.automation.stoppedAt=at;
    }
    return;
  }
  if(e.type==="mission.automation.start"){
    if(actor.kind!=="person")fail("a person must approve automatic execution");
    if(!Number.isInteger(e.maxStarts)||e.maxStarts<1||e.maxStarts>32)
      fail("automatic task budget must be 1-32");
    if(mission.paused||mission.automation?.enabled)fail("mission paused or automation already active");
    const tasks=Object.values(mission.tasks);
    if(tasks.some(t=>t.status==="running"||t.status==="failed"))
      fail("interrupted or failed work needs manual review");
    if(tasks.every(t=>t.status==="done"))fail("mission already complete");
    const kinds=new Set(["text-normalize","text-metrics","text-inspect"]);
    if(tasks.some(t=>(t.spec.effect!==undefined&&t.spec.effect!=="local")||
         !kinds.has(t.spec.taskKind)))
      fail("automatic execution is limited to fixed local text workers");
    mission.automation={enabled:true,maxStarts:e.maxStarts,starts:0,
      approvedBy:actor.id,approvedAt:at};
    return;
  }
  if(e.type==="mission.automation.stop"){
    if(!mission.automation?.enabled)fail("automatic execution is not active");
    if(actor.kind==="person"){
      if(e.reason!=="user-stopped")fail("person may only stop their own approval");
    } else if(actor.kind!=="system"||actor.id!=="system:mission-scheduler"||
       !["complete","budget-exhausted","blocked","needs-review","interrupted","paused"].includes(e.reason)){
      fail("scheduler stop requires a trusted system actor");
    }
    mission.automation.enabled=false;
    mission.automation.stoppedReason=e.reason;
    mission.automation.stoppedAt=at;
    return;
  }
  if(e.type==="mission.gate.resolve"){
    const gate=mission.plan.constraints?.find(g=>g.id===e.constraintId);
    if(!gate || !["approval","condition","deadline"].includes(gate.kind))
      fail("constraint cannot be resolved");
    if(actor.kind!=="person" || (gate.kind==="approval" && actor.id!==gate.approverId))
      fail("constraint requires the designated person");
    bounded(e.evidenceRef,"gate evidence reference",256);
    if(mission.resolvedGates?.[gate.id])fail("constraint already resolved");
    mission.resolvedGates??={};
    mission.resolvedGates[gate.id]={by:actor.id,at,evidenceRef:e.evidenceRef};
    return;
  }
  if(e.type==="task.retry"){
    if(actor.kind!=="person")fail("person required to review interrupted task");
    const task=mission.tasks[e.taskId];if(!task)fail("unknown task");
    if(!["running","failed"].includes(task.status)||!task.run)fail("task is not retryable");
    if(task.spec.effect!==undefined&&task.spec.effect!=="local")
      fail("external task must never be retried without a separate idempotency protocol");
    const fixedAdapters=new Set(["text-normalize","text-metrics","text-inspect"]);
    if(!fixedAdapters.has(task.run.adapterId) ||
       !fixedAdapters.has(task.run.workerId) ||
       !["text-normalize","text-metrics","text-inspect"].includes(task.spec.taskKind))
      fail("retry requires a known side-effect-free local adapter");
    bounded(e.reason,"retry justification",600);
    task.attempts??=[];
    if(task.attempts.length>=3)fail("manual retry review limit reached");
    task.attempts.push({...structuredClone(task.run),
      retryReview:{by:actor.id,reason:e.reason,at}});
    task.status="queued";
    task.run=undefined;
    return;
  }
  if(actor.kind!=="system"||actor.id!=="system:mission-runner")fail("task transitions belong to server runner");
  if(typeof e.taskId!=="string")fail("missing task");
  const task=mission.tasks[e.taskId];if(!task)fail("unknown task");
  if(e.type==="task.started"){
    if(mission.paused)fail("mission paused");
    if(task.status!=="queued")fail("task already started");
    if(task.spec.dependsOn.some(d=>mission.tasks[d].status!=="done"))fail("unfinished dependencies");
    if(blockingConstraints(mission,e.taskId).length)fail("task blocked by unresolved instruction constraints");
    const r=e.run;
    if(!plain(r)||typeof r.runId!=="string"||!ID.test(r.runId)||
       typeof r.workerId!=="string"||!ID.test(r.workerId)||
       typeof r.workerVersion!=="string"||!r.workerVersion||
       typeof r.adapterId!=="string"||!r.adapterId||
       typeof r.startedAt!=="string"||
       typeof r.inputHash!=="string"||!/^[a-f0-9]{64}$/.test(r.inputHash)||
       r.verification!=="not-evaluated")fail("invalid task start");
    if(mission.automation?.enabled){
      if(mission.automation.starts>=mission.automation.maxStarts)
        fail("automatic task budget exhausted");
      mission.automation.starts+=1;
    }
    task.status="running";task.run=structuredClone(r) as TaskRun;
    return;
  }
  if(task.status!=="running"||!task.run||task.run.runId!==e.runId)fail("stale task result");
  if(typeof e.finishedAt!=="string"||!Number.isFinite(e.elapsedMs)||e.elapsedMs<0)fail("invalid task timing");
  if(e.type==="task.completed"){
    if(!plain(e.output)||JSON.stringify(e.output).length>16384||
       !/^[a-f0-9]{64}$/.test(e.outputHash))fail("invalid output");
    task.run.output=structuredClone(e.output);
    task.run.outputHash=e.outputHash;task.status="done";
  }else if(e.type==="task.failed"){
    if(!["adapter-error","output-invalid","worker-unavailable"].includes(e.errorCode))fail("invalid failure");
    task.run.errorCode=e.errorCode;task.status="failed";
  }else fail("unknown mission event");
  task.run.finishedAt=e.finishedAt;task.run.elapsedMs=e.elapsedMs;
}
/** A proposal may identify constraints but may never clear them. */
export function blockingConstraints(m:MissionRecord,taskId:string):MissionConstraint[] {
  return (m.plan.constraints??[]).filter(g=>g.taskIds.includes(taskId) &&
    (g.kind==="prohibition"||((g.kind==="approval"||g.kind==="condition"||g.kind==="deadline")&&!m.resolvedGates?.[g.id])));
}
export function missionProgress(m:MissionRecord){
  const tasks=Object.values(m.tasks);
  const done=tasks.filter(t=>t.status==="done").length;
  const failed=tasks.filter(t=>t.status==="failed").length;
  const running=tasks.filter(t=>t.status==="running").length;
  const ready=tasks.filter(t=>t.status==="queued"&&t.spec.dependsOn.every(d=>m.tasks[d].status==="done") &&
    blockingConstraints(m,t.spec.id).length===0).length;
  const blockedByConstraints=tasks.filter(t=>t.status==="queued"&&blockingConstraints(m,t.spec.id).length>0).length;
  return {total:tasks.length,done,failed,running,ready,blockedByConstraints,
    status:m.paused?"paused":done===tasks.length?"complete":failed?"needs-review":running?"running":ready?"ready":"waiting"} as const;
}

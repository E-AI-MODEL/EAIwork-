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
export interface MissionPhase {
  id:string;
  title:string;
  /** Exactly one phase must contain each planned task. */
  taskIds:string[];
}
export interface MissionPlan {
  /** The original request is preserved unchanged; no model may rewrite it. */
  sourceInstruction?:string;
  constraints?:MissionConstraint[];
  id:string;
  title:string;
  goal:string;
  tasks:MissionTask[];
  /** Optional named phases. Without these, dependency levels are used for display. */
  phases?:MissionPhase[];
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
  /** Durable lease record for the limited local subprocess queue. */
  lease?:{id:string;ownerId:string;expiresAt:string;renewals:number};
  retryReview?:{by:string;reason:string;at:string};
  /** A stopped local calculation, not an external action, may be recovered. */
  recovery?:{by:string;reason:"process-restart";at:string};
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
  /** Explicit opt-in to continue queued, side-effect-free work after restart. */
  resumeAfterRestart?:boolean;
  /** Remote text mode still uses the same human-approved start budget. */
  executionMode?:"local-scheduler"|"remote-text";
  /** Only these executor identities may receive the mission's text input. */
  executorIds?:string[];
  maxStarts:number;
  starts:number;
  approvedBy:string;
  approvedAt:string;
  stoppedReason?:SchedulerStopReason;
  stoppedAt?:string;
}
export interface ReleaseCandidate {
  id:string;
  revision:number;
  repository:string;
  commitSha:string;
  artifactName:string;
  artifactSha256:string;
  /** A user-supplied link, never evidence the CI run actually passed. */
  checkRunUrl:string;
  checkCommitSha:string;
  outputHashes:Record<string,string>;
  proposedBy:string;
  proposedAt:string;
  status:"pending-review"|"changes-requested"|"accepted-for-verification"|"superseded";
  review?:{by:string;at:string;decision:"request-changes"|"accept-for-verification";reason:string};
}
export interface MissionRecord {
  /** Plans begin at revision 1; every accepted extension is an audit event. */
  revision:number;
  automation?:MissionAutomation;
  plan:MissionPlan;
  createdAt:string;
  createdBy:string;
  paused:boolean;
  resolvedGates:Record<string,GateResolution>;
  tasks:Record<string,MissionTaskRecord>;
  releaseCandidates?:Record<string,ReleaseCandidate>;
}
export type MissionEvent =
  | {type:"mission.create";plan:MissionPlan}
  | {type:"mission.pause";missionId:string}
  | {type:"mission.extend";missionId:string;expectedRevision:number;plan:MissionPlan}
  | {type:"mission.release.propose";missionId:string;candidate:{
      id:string;revision:number;repository:string;commitSha:string;
      artifactName:string;artifactSha256:string;checkRunUrl:string;checkCommitSha:string;
    }}
  | {type:"mission.release.review";missionId:string;candidateId:string;
      decision:"request-changes"|"accept-for-verification";reason:string}
  | {type:"mission.resume";missionId:string}
  | {type:"mission.automation.start";missionId:string;maxStarts:number;resumeAfterRestart?:boolean;executionMode?:"local-scheduler"|"remote-text";executorIds?:string[]}
  | {type:"mission.automation.stop";missionId:string;reason:SchedulerStopReason}
  | {type:"mission.gate.resolve";missionId:string;constraintId:string;evidenceRef:string}
  | {type:"task.retry";missionId:string;taskId:string;reason:string}
  | {type:"task.recover";missionId:string;taskId:string;runId:string}
  | {type:"task.started";missionId:string;taskId:string;run:Pick<TaskRun,"runId"|"workerId"|"workerVersion"|"adapterId"|"inputHash"|"startedAt"|"verification">}
  | {type:"task.lease.claim";missionId:string;taskId:string;run:Pick<TaskRun,"runId"|"workerId"|"workerVersion"|"adapterId"|"inputHash"|"startedAt"|"verification">;leaseId:string;ownerId:string;expiresAt:string}
  | {type:"task.lease.renew";missionId:string;taskId:string;runId:string;leaseId:string;ownerId:string;expiresAt:string}
  | {type:"task.lease.expire";missionId:string;taskId:string;runId:string;leaseId:string}
  | {type:"task.completed";missionId:string;taskId:string;runId:string;leaseId?:string;finishedAt:string;elapsedMs:number;output:Record<string,unknown>;outputHash:string}
  | {type:"task.failed";missionId:string;taskId:string;runId:string;leaseId?:string;finishedAt:string;elapsedMs:number;errorCode:"adapter-error"|"output-invalid"|"worker-unavailable"};
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
  if(plan.phases!==undefined){
    if(!Array.isArray(plan.phases)||plan.phases.length<1||plan.phases.length>16)
      fail("invalid mission phases");
    const phaseIds=new Set<string>(),taskPhase=new Map<string,number>();
    plan.phases.forEach((phase,index)=>{
      if(!plain(phase)||typeof phase.id!=="string"||!ID.test(phase.id)||phaseIds.has(phase.id))
        fail("invalid or duplicate phase id");
      phaseIds.add(phase.id);
      bounded(phase.title,"phase title",160);
      if(!Array.isArray(phase.taskIds)||phase.taskIds.length<1||
         phase.taskIds.some(id=>typeof id!=="string"||!ids.has(id)||taskPhase.has(id)))
        fail("invalid or duplicate phase task");
      for(const id of phase.taskIds)taskPhase.set(id,index);
    });
    if(taskPhase.size!==plan.tasks.length)fail("every task must belong to one phase");
    for(const task of plan.tasks)for(const dep of task.dependsOn){
      if((taskPhase.get(dep)!)>(taskPhase.get(task.id)!))
        fail("a phase dependency cannot point to a later phase");
    }
  }
}
/** Shared, side-effect-free validator for both proposals and approvals. */
export function validateMissionExtension(mission:MissionRecord,plan:MissionPlan,expectedRevision:number):void {
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==mission.revision)
      fail("stale mission plan revision");
    if(mission.automation?.enabled ||
       Object.values(mission.tasks).some(t=>t.status==="running"))
      fail("stop automatic or running work before changing plan");
    validateMissionPlan(plan);
    const old=mission.plan;
    if(old.id!==plan.id||old.title!==plan.title||old.goal!==plan.goal||
       old.sourceInstruction!==plan.sourceInstruction)
      fail("an extension must preserve the original mission instruction");
    if(plan.tasks.length<=old.tasks.length||
       old.tasks.some((task,i)=>JSON.stringify(plan.tasks[i])!==JSON.stringify(task)))
      fail("an extension may only append tasks, never rewrite existing work");
    const added=plan.tasks.slice(old.tasks.length).map(t=>t.id);
    if(old.phases){
      if(!plan.phases||plan.phases.length<=old.phases.length||
         old.phases.some((phase,i)=>JSON.stringify(plan.phases![i])!==JSON.stringify(phase)))
        fail("new phases must append without moving existing tasks");
    }
    for(const guard of old.constraints??[]){
      const next=plan.constraints?.find(g=>g.id===guard.id);
      if(!next || next.kind!==guard.kind || next.quote!==guard.quote ||
         next.start!==guard.start || next.end!==guard.end ||
         next.approverId!==guard.approverId ||
         !guard.taskIds.every(id=>next.taskIds.includes(id)) ||
         !added.every(id=>next.taskIds.includes(id)))
        fail("existing instruction constraints must cover appended tasks");
    }
}
export function applyMissionEvent(
  missions:Record<string,MissionRecord>,e:MissionEvent,actor:MissionActor,
  at:string,verifiedJournalReplay=false,
):void {
  if(e.type==="mission.create"){
    if(actor.kind!=="person")fail("a person must approve a mission");
    validateMissionPlan(e.plan);
    if(missions[e.plan.id])fail("duplicate mission");
    missions[e.plan.id]={
      plan:structuredClone(e.plan),revision:1,createdAt:at,createdBy:actor.id,paused:false,resolvedGates:{},
      tasks:Object.fromEntries(e.plan.tasks.map(t=>[t.id,{spec:structuredClone(t),status:"queued"}])),
    };
    return;
  }
  if(typeof e.missionId!=="string")fail("missing mission");
  const mission=missions[e.missionId];if(!mission)fail("unknown mission");
  if(e.type==="mission.extend"){
    if(actor.kind!=="person"||actor.id!==mission.createdBy)
      fail("mission extension requires the original human approver");
    validateMissionExtension(mission,e.plan,e.expectedRevision);
    for(const task of e.plan.tasks.slice(mission.plan.tasks.length))
      mission.tasks[task.id]={spec:structuredClone(task),status:"queued"};
    mission.plan=structuredClone(e.plan);
    mission.revision++;
    for(const c of Object.values(mission.releaseCandidates??{}))
      if(c.status==="pending-review"||c.status==="accepted-for-verification")
        c.status="superseded";
    // Approval for an earlier task cannot silently authorize a new task.
    // Reconfirm all source-anchored gates after scope expansion.
    mission.resolvedGates={};
    return;
  }
  if(e.type==="mission.release.propose"){
    if(actor.kind!=="person"||actor.id!==mission.createdBy)
      fail("only the mission owner may submit a release candidate");
    const c=e.candidate;
    if(!plain(c)||typeof c.id!=="string"||!ID.test(c.id)||
       !Number.isSafeInteger(c.revision)||c.revision!==mission.revision)
      fail("invalid or stale release candidate");
    if(Object.keys(c).some(k=>!["id","revision","repository","commitSha",
       "artifactName","artifactSha256","checkRunUrl","checkCommitSha"].includes(k)))
      fail("unexpected release candidate field");
    const repoParts=typeof c.repository==="string"?c.repository.split("/"):[];
    const checkPrefix="https://github.com/"+c.repository+"/actions/runs/";
    const runId=typeof c.checkRunUrl==="string"&&c.checkRunUrl.startsWith(checkPrefix)?
      c.checkRunUrl.slice(checkPrefix.length):"";
    if(repoParts.length!==2||repoParts.some(part=>!(/^[a-zA-Z0-9_.-]{1,90}$/.test(part)))||
       !/^[a-f0-9]{40}$/.test(c.commitSha)||
       !/^[a-f0-9]{64}$/.test(c.artifactSha256)||
       c.checkCommitSha!==c.commitSha ||
       typeof c.artifactName!=="string"||
       !/^[a-zA-Z0-9_.-]{1,160}$/.test(c.artifactName)||
       !(/^[0-9]+$/.test(runId)))
      fail("release references must be exact and consistently scoped");
    if(mission.paused||mission.automation?.enabled||
       Object.values(mission.tasks).some(t=>t.status!=="done"||!t.run?.outputHash))
      fail("all tasks must finish before a candidate can be submitted");
    if((mission.plan.constraints??[]).some(g=>g.kind==="prohibition"||
       !mission.resolvedGates[g.id]))
      fail("source restrictions must be reviewed before a release candidate");
    mission.releaseCandidates??={};
    if(Object.keys(mission.releaseCandidates).length>=8)
      fail("release candidate history limit reached");
    if(mission.releaseCandidates[c.id]||
       Object.values(mission.releaseCandidates).some(other=>
         other.status==="pending-review"&&other.revision===mission.revision))
      fail("release candidate already pending");
    mission.releaseCandidates[c.id]={
      ...structuredClone(c),
      outputHashes:Object.fromEntries(mission.plan.tasks.map(t=>[
        t.id,mission.tasks[t.id].run!.outputHash!,
      ])),
      proposedBy:actor.id,proposedAt:at,status:"pending-review",
    };
    return;
  }
  if(e.type==="mission.release.review"){
    if(actor.kind!=="person"||actor.id===mission.createdBy)
      fail("release review requires a different human reviewer");
    const candidate=mission.releaseCandidates?.[e.candidateId];
    if(!candidate||candidate.status!=="pending-review"||
       candidate.revision!==mission.revision)
      fail("unknown or stale release candidate for review");
    if(!["request-changes","accept-for-verification"].includes(e.decision))
      fail("invalid review decision");
    bounded(e.reason,"review explanation",900);
    if(Object.entries(candidate.outputHashes).some(([taskId,hash])=>
       mission.tasks[taskId]?.run?.outputHash!==hash)||
       mission.plan.tasks.length!==Object.keys(candidate.outputHashes).length)
      fail("mission results changed since candidate submission");
    candidate.review={by:actor.id,at,decision:e.decision,reason:e.reason};
    candidate.status=e.decision==="request-changes"?
      "changes-requested":"accepted-for-verification";
    // Neither review result authorizes upload, deployment or publication.
    return;
  }
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
    if(actor.id!==mission.createdBy)fail("only the mission creator may approve automatic execution");
    if(!Number.isInteger(e.maxStarts)||e.maxStarts<1||e.maxStarts>32)
      fail("automatic task budget must be 1-32");
    if(e.resumeAfterRestart!==undefined&&typeof e.resumeAfterRestart!=="boolean")
      fail("invalid restart continuation consent");
    if(mission.paused||mission.automation?.enabled)fail("mission paused or automation already active");
    if(e.executionMode!==undefined &&
       !["local-scheduler","remote-text"].includes(e.executionMode))
      fail("invalid automation execution mode");
    if(e.executionMode==="remote-text"){
      // Legacy consent without an allowlist remains replayable, but no
      // executor can claim work until a human grants fresh scoped consent.
      if(e.executorIds!==undefined && (
        !Array.isArray(e.executorIds)||e.executorIds.length<1||
        e.executorIds.length>8||e.executorIds.some(id=>
          typeof id!=="string"||!/^executor-[a-z0-9-]{3,55}$/.test(id))||
        new Set(e.executorIds).size!==e.executorIds.length))
        fail("invalid authorized executor list");
    }else if(e.executorIds!==undefined)
      fail("executor list only applies to remote text mode");
    const tasks=Object.values(mission.tasks);
    if(tasks.some(t=>t.status==="running"||t.status==="failed"))
      fail("interrupted or failed work needs manual review");
    if(tasks.every(t=>t.status==="done"))fail("mission already complete");
    const kinds=new Set(e.executionMode==="remote-text"?
      ["text-normalize","text-metrics","text-inspect","reference-extract"]:
      ["text-normalize","text-metrics","text-inspect","reference-extract"]);
    if(tasks.some(t=>(t.spec.effect!==undefined&&t.spec.effect!=="local")||
         !kinds.has(t.spec.taskKind)))
      fail("automatic execution is limited to fixed local text workers");
    mission.automation={enabled:true,maxStarts:e.maxStarts,starts:0,
      executionMode:e.executionMode??"local-scheduler",
      ...(e.executionMode==="remote-text"?{executorIds:[...(e.executorIds??[])]}:{}),
      resumeAfterRestart:e.resumeAfterRestart===true,
      approvedBy:actor.id,approvedAt:at};
    return;
  }
  if(e.type==="mission.automation.stop"){
    if(!mission.automation?.enabled)fail("automatic execution is not active");
    if(actor.kind==="person"){
      if(actor.id!==mission.createdBy)fail("only the mission creator may stop their automatic execution");
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
    if(!gate || !["approval","condition","deadline","uncertainty"].includes(gate.kind))
      fail("constraint cannot be resolved");
    if(actor.kind!=="person" ||
       (gate.kind==="approval" && actor.id!==gate.approverId) ||
       (gate.kind==="uncertainty" && actor.id!==mission.createdBy))
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
    const knownWorkerId:Record<string,string>={
      "text-normalize":"text-normalize","text-metrics":"text-metrics",
      "text-inspect":"text-inspector","reference-extract":"reference-extract",
    };
    if(knownWorkerId[task.spec.taskKind]!==task.run.workerId ||
       task.run.adapterId!==task.spec.taskKind)
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
  if(e.type==="task.recover"){
    if(actor.kind!=="system"||actor.id!=="system:mission-scheduler")
      fail("only trusted scheduler may recover local work");
    if(!mission.automation?.enabled||!mission.automation.resumeAfterRestart||mission.paused)
      fail("no human consent to recover after restart");
    if(mission.automation.starts>=mission.automation.maxStarts)
      fail("no remaining approved task starts");
    const task=mission.tasks[e.taskId];
    if(!task||task.status!=="running"||!task.run||task.run.runId!==e.runId)
      fail("no matching in-flight task to recover");
    if(task.run.lease)fail("leased tasks must not be automatically replayed");
    // Recovery is permitted only for these two pure, built-in adapters.
    // Other composed or external adapters require human review.
    if((task.spec.effect!==undefined&&task.spec.effect!=="local")||
       !["text-normalize","text-metrics"].includes(task.spec.taskKind) ||
       task.run.workerId!==task.spec.taskKind ||
       task.run.adapterId!==task.spec.taskKind)
      fail("only known side-effect-free builtins can recover automatically");
    task.attempts??=[];
    if(task.attempts.length>=3)fail("automatic recovery history limit reached");
    task.attempts.push({...structuredClone(task.run),
      recovery:{by:actor.id,reason:"process-restart",at}});
    task.status="queued";
    task.run=undefined;
    return;
  }
  if(e.type==="task.lease.renew"||e.type==="task.lease.expire"){
    if(actor.kind!=="system"||actor.id!=="system:mission-runner")
      fail("lease transitions require the trusted server runner");
    const task=mission.tasks[e.taskId];
    const lease=task?.run?.lease;
    if(!task||task.status!=="running"||!lease||task.run?.runId!==e.runId||
       lease.id!==e.leaseId)fail("stale task lease");
    const eventTime=Date.parse(at);
    if(!Number.isFinite(eventTime))fail("invalid lease event time");
    if(e.type==="task.lease.renew"){
      if(typeof e.ownerId!=="string"||e.ownerId!==lease.ownerId)
        fail("lease owner mismatch");
      const expiry=Date.parse(e.expiresAt);
      if(!Number.isFinite(expiry)||expiry<=eventTime||
         expiry<=Date.parse(lease.expiresAt)||expiry-eventTime>30000||
         eventTime>=Date.parse(lease.expiresAt)||lease.renewals>=20)
        fail("lease renewal denied");
      lease.expiresAt=e.expiresAt;
      lease.renewals++;
    }else{
      if(eventTime<Date.parse(lease.expiresAt))
        fail("lease has not expired");
      // An expiry cannot silently authorize another start. The human
      // reviewer must use the existing bounded local task.retry path.
      task.status="failed";
      task.run.errorCode="worker-unavailable";
      task.run.finishedAt=at;
      task.run.elapsedMs=Math.max(0,eventTime-Date.parse(task.run.startedAt));
    }
    return;
  }
  if(actor.kind!=="system"||actor.id!=="system:mission-runner")fail("task transitions belong to server runner");
  if(typeof e.taskId!=="string")fail("missing task");
  const task=mission.tasks[e.taskId];if(!task)fail("unknown task");
  if(e.type==="task.started"||e.type==="task.lease.claim"){
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
    if(Object.values(mission.tasks).some(other=>
       other.run?.runId===r.runId || other.attempts?.some(previous=>previous.runId===r.runId)))
      fail("duplicate task run id");
    let lease:TaskRun["lease"]|undefined;
    if(e.type==="task.lease.claim"){
      if(mission.automation?.enabled &&
         (mission.automation.executionMode!=="remote-text"||
          (!mission.automation.executorIds?.includes(e.ownerId) &&
           !(verifiedJournalReplay && mission.automation.executorIds?.length===0))))
        fail("leased subprocesses require approval for this executor");
      if(typeof e.leaseId!=="string"||!ID.test(e.leaseId)||
         typeof e.ownerId!=="string"||!ID.test(e.ownerId))
        fail("invalid lease identity");
      const knownWorkerId:Record<string,string>={
        "text-normalize":"text-normalize","text-metrics":"text-metrics",
        "text-inspect":"text-inspector","reference-extract":"reference-extract",
      };
      if((task.spec.effect!==undefined&&task.spec.effect!=="local")||
         knownWorkerId[task.spec.taskKind]!==r.workerId||
         r.adapterId!==task.spec.taskKind)
        fail("lease restricted to fixed side-effect-free text workers");
      const started=Date.parse(r.startedAt),expires=Date.parse(e.expiresAt);
      if(!Number.isFinite(started)||!Number.isFinite(expires)||
         expires<=started||expires-started>30000)
        fail("lease duration must be at most 30 seconds");
      lease={id:e.leaseId,ownerId:e.ownerId,expiresAt:e.expiresAt,renewals:0};
    }
    if(mission.automation?.enabled){
      if(e.type==="task.started" && mission.automation.executionMode==="remote-text")
        fail("remote text consent cannot be consumed by a local task");
      if(mission.automation.starts>=mission.automation.maxStarts)
        fail("automatic task budget exhausted");
      mission.automation.starts+=1;
    }
    task.status="running";task.run={...structuredClone(r),...(lease?{lease}:{})} as TaskRun;
    return;
  }
  if(task.status!=="running"||!task.run||task.run.runId!==e.runId)fail("stale task result");
  if(task.run.lease){
    if(e.leaseId!==task.run.lease.id)
      fail("stale task lease");
    const finished=Date.parse(e.finishedAt),committed=Date.parse(at);
    const expires=Date.parse(task.run.lease.expiresAt);
    if(!Number.isFinite(finished)||!Number.isFinite(committed)||
       finished>expires||committed>expires||
       finished>committed||committed-finished>5000)
      fail("task lease expired before completion");
  }else if(e.leaseId!==undefined)fail("unexpected lease token");
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
    (g.kind==="prohibition"||((g.kind==="approval"||g.kind==="condition"||g.kind==="deadline"||g.kind==="uncertainty")&&!m.resolvedGates?.[g.id])));
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

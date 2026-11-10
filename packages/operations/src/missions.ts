/**
 * Approved, dependency-aware mission plans and replayable task transitions.
 * Status describes execution, not epistemic support or independent verification.
 */
export type MissionActor = {kind:"person"|"system"|"check";id:string};
export interface MissionTask {
  id:string;
  title:string;
  taskKind:string;
  dependsOn:string[];
  input?:{text:string};
  textFrom?:string;
}
export interface MissionPlan {
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
}
export interface MissionTaskRecord {
  spec:MissionTask;
  status:"queued"|"running"|"done"|"failed";
  run?:TaskRun;
}
export interface MissionRecord {
  plan:MissionPlan;
  createdAt:string;
  createdBy:string;
  paused:boolean;
  tasks:Record<string,MissionTaskRecord>;
}
export type MissionEvent =
  | {type:"mission.create";plan:MissionPlan}
  | {type:"mission.pause";missionId:string}
  | {type:"mission.resume";missionId:string}
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
    if(!Array.isArray(task.dependsOn)||task.dependsOn.length>32||
      !task.dependsOn.every(x=>typeof x==="string"&&ID.test(x))||
      new Set(task.dependsOn).size!==task.dependsOn.length)fail("invalid dependencies");
    if(task.textFrom!==undefined&&(typeof task.textFrom!=="string"||!ID.test(task.textFrom)))fail("invalid text source");
    if(task.input!==undefined&&(!plain(task.input)||typeof task.input.text!=="string"||task.input.text.length>12000||
       Object.keys(task.input).some(key=>key!=="text")))fail("invalid task input");
    if((task.input===undefined)===(task.textFrom===undefined))fail("exactly one input or textFrom required");
    if(task.textFrom!==undefined&&!task.dependsOn.includes(task.textFrom))fail("textFrom must be a declared dependency");
  }
  const index=new Map(plan.tasks.map(t=>[t.id,t]));
  for(const task of plan.tasks)for(const dep of task.dependsOn)
    if(!index.has(dep)||dep===task.id)fail("unknown or self dependency");
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
      plan:structuredClone(e.plan),createdAt:at,createdBy:actor.id,paused:false,
      tasks:Object.fromEntries(e.plan.tasks.map(t=>[t.id,{spec:structuredClone(t),status:"queued"}])),
    };
    return;
  }
  if(typeof e.missionId!=="string")fail("missing mission");
  const mission=missions[e.missionId];if(!mission)fail("unknown mission");
  if(e.type==="mission.pause"||e.type==="mission.resume"){
    if(actor.kind!=="person")fail("person required to pause or resume");
    mission.paused=e.type==="mission.pause";
    return;
  }
  if(actor.kind!=="system"||actor.id!=="system:mission-runner")fail("task transitions belong to server runner");
  if(typeof e.taskId!=="string")fail("missing task");
  const task=mission.tasks[e.taskId];if(!task)fail("unknown task");
  if(e.type==="task.started"){
    if(mission.paused)fail("mission paused");
    if(task.status!=="queued")fail("task already started");
    if(task.spec.dependsOn.some(d=>mission.tasks[d].status!=="done"))fail("unfinished dependencies");
    const r=e.run;
    if(!plain(r)||typeof r.runId!=="string"||!ID.test(r.runId)||
       typeof r.workerId!=="string"||!ID.test(r.workerId)||
       typeof r.workerVersion!=="string"||!r.workerVersion||
       typeof r.adapterId!=="string"||!r.adapterId||
       typeof r.startedAt!=="string"||
       typeof r.inputHash!=="string"||!/^[a-f0-9]{64}$/.test(r.inputHash)||
       r.verification!=="not-evaluated")fail("invalid task start");
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
export function missionProgress(m:MissionRecord){
  const tasks=Object.values(m.tasks);
  const done=tasks.filter(t=>t.status==="done").length;
  const failed=tasks.filter(t=>t.status==="failed").length;
  const running=tasks.filter(t=>t.status==="running").length;
  const ready=tasks.filter(t=>t.status==="queued"&&t.spec.dependsOn.every(d=>m.tasks[d].status==="done")).length;
  return {total:tasks.length,done,failed,running,ready,
    status:m.paused?"paused":done===tasks.length?"complete":failed?"needs-review":running?"running":ready?"ready":"waiting"} as const;
}

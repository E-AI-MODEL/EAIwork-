/**
 * Deterministic, read-only inspection of a proposed mission.
 * This does not approve, schedule or execute work. Model-identified gaps are
 * unverified questions and source spans are not proof of semantic completeness.
 */
import {validateMissionPlan,type MissionPlan,type MissionTask} from "./missions.ts";
import {selectWorker,type RuntimeInventory} from "./selector.ts";
import type {OpsState} from "./registry.ts";

export type PreflightTask = {
  taskId:string;
  phaseId:string;
  phaseTitle:string;
  dependencyLevel:number;
  dependsOn:string[];
  effect:string;
  constraintIds:string[];
  blockers:string[];
  selectedWorkerId:string|null;
  workerAssessment:"candidate-only"|"not-checked"|"not-available";
};
export interface MissionPreflight {
  status:"requires-human-review";
  structuralValidation:"passed";
  instructionCoverage:"not-evaluated";
  approvalGranted:false;
  canExecute:false;
  planId:string;
  phases:Array<{id:string;title:string;taskIds:string[]}>;
  dependencyWaves:string[][];
  tasks:PreflightTask[];
  missingInformation:string[];
  warnings:string[];
}

/**
 * Only an explicitly provided trusted registry/runtime can yield candidate
 * workers. A candidate is not evidence that a task will execute successfully.
 */
export function inspectMissionPlan(
  plan:MissionPlan,
  opts:{state?:OpsState;runtime?:RuntimeInventory;missingInformation?:string[]}={},
):MissionPreflight {
  validateMissionPlan(plan);
  if((opts.state===undefined)!==(opts.runtime===undefined))
    throw new Error("preflight requires both state and trusted runtime or neither");
  const missing=opts.missingInformation??[];
  if(!Array.isArray(missing)||missing.length>16||missing.some(x=>typeof x!=="string"||!x.trim()||x.length>240))
    throw new Error("invalid missing-information questions");
  const tasks=new Map(plan.tasks.map(task=>[task.id,task]));
  const levels=new Map<string,number>();
  const level=(id:string):number=>{
    const cached=levels.get(id);
    if(cached!==undefined)return cached;
    const task=tasks.get(id)!;
    const value=task.dependsOn.length?1+Math.max(...task.dependsOn.map(level)):0;
    levels.set(id,value);
    return value;
  };
  for(const task of plan.tasks)level(task.id);
  const waves:Array<string[]>=Array.from({length:Math.max(...levels.values())+1},()=>[]);
  for(const task of plan.tasks)waves[levels.get(task.id)!].push(task.id);
  const phases=plan.phases?.map(phase=>({
    id:phase.id,title:phase.title,taskIds:[...phase.taskIds],
  }))??waves.map((ids,index)=>({
    id:"phase-"+(index+1).toString().padStart(2,"0"),
    title:"Afhankelijkheidsniveau "+(index+1),taskIds:[...ids],
  }));
  const phaseByTask=new Map<string,{id:string;title:string}>();
  for(const phase of phases)for(const id of phase.taskIds)
    phaseByTask.set(id,{id:phase.id,title:phase.title});
  const found=plan.tasks.map(task=>{
    const constraints=(plan.constraints??[]).filter(g=>g.taskIds.includes(task.id));
    const blockers:string[]=[];
    if(constraints.some(c=>c.kind==="prohibition"))blockers.push("original-prohibition");
    if(constraints.some(c=>c.kind==="approval"))blockers.push("human-approval-required");
    if(constraints.some(c=>c.kind==="condition"))blockers.push("condition-not-resolved");
    if(constraints.some(c=>c.kind==="deadline"))blockers.push("deadline-not-verified");
    if(constraints.some(c=>c.kind==="uncertainty"))blockers.push("uncertainty-not-resolved");
    if(task.effect!==undefined&&task.effect!=="local")blockers.push("external-effect-not-authorized");
    let selectedWorkerId:string|null=null;
    let workerAssessment:PreflightTask["workerAssessment"]="not-checked";
    if(opts.state&&opts.runtime){
      const matched=selectWorker({taskKind:task.taskKind},opts.state,opts.runtime);
      selectedWorkerId=matched.selectedWorkerId;
      workerAssessment=selectedWorkerId?"candidate-only":"not-available";
      if(!selectedWorkerId)blockers.push("no-available-runtime-worker");
    }
    const phase=phaseByTask.get(task.id)!;
    return {taskId:task.id,phaseId:phase.id,phaseTitle:phase.title,
      dependencyLevel:levels.get(task.id)!,dependsOn:[...task.dependsOn],
      effect:task.effect??"local",constraintIds:constraints.map(c=>c.id),
      blockers,selectedWorkerId,workerAssessment};
  });
  const warnings=[
    "Een geldig takenplan bewijst niet dat alle voorwaarden uit de oorspronkelijke opdracht zijn gevonden.",
    "De uitvoeringsgolven tonen alleen afhankelijkheden. Ze geven geen toestemming voor parallelle uitvoering.",
  ];
  if(missing.length)warnings.push("Open vragen zijn modelvoorstellen; de ontbrekende feiten zijn niet zelfstandig vastgesteld.");
  if(found.some(t=>t.workerAssessment==="not-available"))
    warnings.push("Voor sommige taken is geen toegelaten uitvoeradapter beschikbaar.");
  if(found.some(t=>t.blockers.includes("uncertainty-not-resolved")))
    warnings.push("Onzekerheden houden de betreffende taken tegen totdat een persoon ze beoordeelt.");
  return {status:"requires-human-review",structuralValidation:"passed",
    instructionCoverage:"not-evaluated",approvalGranted:false,canExecute:false,
    planId:plan.id,phases,dependencyWaves:waves,tasks:found,
    missingInformation:[...missing],warnings};
}

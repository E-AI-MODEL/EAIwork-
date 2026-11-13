/**
 * Deterministic preflight selector. This module does NOT start workers.
 * A released contract is only eligible after its actual adapter, tool capabilities
 * and permissions have been confirmed by trusted runtime configuration.
 */
import { WORKER_BLUEPRINTS, type ModelSize, type WorkerBlueprint } from "./catalog.ts";
import type { OpsState, WorkerRecord, QualityMeasurement } from "./registry.ts";

export interface TaskRequirement {
  taskKind: string;
  requiredCapabilities?: string[];
  allowedModelSizes?: ModelSize[];
}
export interface RuntimeInventory {
  /** Confirmed by backend configuration, never by model output. */
  adapterIds: string[];
  capabilities: string[];
  grantedPermissions: string[];
  supportedModelSizes: ModelSize[];
}
export type MatchReason =
  | "registered-and-ready"
  | "adapter-missing"
  | "not-released"
  | "missing-capabilities"
  | "permission-denied"
  | "model-unavailable"
  | "unregistered"
  | "no-blueprint";
export interface CandidateMatch {
  workerId: string;
  name: string;
  group: string;
  preferredModel: ModelSize;
  stage: string;
  canConsider: boolean;
  reason: MatchReason;
  missingCapabilities?: string[];
  testMeasurements: number;
  note: string;
}
export interface WorkerSelection {
  taskKind: string;
  /** Selection is advice only; executor must reauthorize before every run. */
  selectedWorkerId: string | null;
  matches: CandidateMatch[];
  nextStep: "assign" | "register-and-test" | "search-and-build";
}
const unique = (v: string[]) => [...new Set(v)];
const validStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(x => typeof x === "string" && x.length > 0 && x.length <= 128);
const testCount = (state: OpsState, id: string, version: string, taskKind: string): number =>
  state.measurements.filter(m => m.workerId === id && m.version === version && m.taskKind === taskKind && m.denominator > 0).length;
const matchRegistered = (
  task: TaskRequirement, state: OpsState, runtime: RuntimeInventory, rec: WorkerRecord,
): CandidateMatch => {
  const c=rec.contract;
  const base={workerId:c.id,name:c.name,group:"registered",preferredModel:c.modelPolicy.preferred,stage:rec.stage,
    testMeasurements:testCount(state,c.id,c.version,task.taskKind)};
  const response=(reason:MatchReason,note:string,missingCapabilities?:string[]):CandidateMatch=>({
    ...base,canConsider:reason==="registered-and-ready",reason,note,
    ...(missingCapabilities?.length?{missingCapabilities}:{}),
  });
  if(rec.stage!=="ready")return response("not-released","Alleen een toegelaten worker mag voorgedragen worden.");
  if(state.defects && Object.values(state.defects).some(d=>d.workerId===c.id && d.version===c.version && (d.state==="open"||d.state==="human-required")))
    return response("not-released","Openstaand kwaliteits- of veiligheidsprobleem.");
  if(!runtime.adapterIds.includes(c.id))
    return response("adapter-missing","Geen uitvoeradapter voor dit contract gekoppeld.");
  const missing=unique([...(task.requiredCapabilities??[]),...c.tools]).filter(x=>!runtime.capabilities.includes(x));
  if(missing.length)return response("missing-capabilities","Niet alle benodigde hulpmiddelen zijn beschikbaar.",missing);
  if(c.requestedPermissions.some(p=>!runtime.grantedPermissions.includes(p)))
    return response("permission-denied","De runtime staat niet alle gevraagde rechten toe.");
  const permitted=task.allowedModelSizes;
  if((permitted?.length && !permitted.includes(c.modelPolicy.preferred)) ||
     (c.modelPolicy.preferred!=="auto" && !runtime.supportedModelSizes.includes(c.modelPolicy.preferred)))
    return response("model-unavailable","Het vereiste modeltype is niet beschikbaar.");
  return response("registered-and-ready","Contract is toegelaten en de runtime lijkt passend; uitvoering vereist een nieuwe rechtencontrole.");
};
export function selectWorker(
  task: TaskRequirement, state: OpsState, runtime: RuntimeInventory,
  blueprints: readonly WorkerBlueprint[]=WORKER_BLUEPRINTS,
): WorkerSelection {
  if(!task || typeof task.taskKind!=="string" || !task.taskKind.trim())
    throw new Error("task kind is required");
  if(!validStrings(task.requiredCapabilities??[]) || !validStrings(task.allowedModelSizes??[]))
    throw new Error("invalid task requirements");
  for(const key of ["adapterIds","capabilities","grantedPermissions","supportedModelSizes"] as const)
    if(!validStrings(runtime[key]))throw new Error("invalid runtime inventory: "+key);
  const registered=Object.values(state.workers)
    .filter(w=>w.contract.taskKinds.includes(task.taskKind))
    .map(w=>matchRegistered(task,state,runtime,w));
  const knownIds=new Set(registered.map(x=>x.workerId));
  const proposed=blueprints.filter(b=>b.taskKinds.includes(task.taskKind)&&!knownIds.has(b.id))
    .map(b=>({
      workerId:b.id,name:b.name,group:b.group,preferredModel:b.suggestedModel,stage:"design-only",
      canConsider:false as const,reason:"unregistered" as const,testMeasurements:0,
      note:"Alleen een catalogusvoorstel. Registreren, testen en een adapter koppelen.",
    }));
  const matches=[...registered,...proposed].sort((a,b)=>
    Number(b.canConsider)-Number(a.canConsider) ||
    // Test counts from different cohorts do not establish relative quality.
    a.workerId.localeCompare(b.workerId));
  return {
    taskKind:task.taskKind,
    selectedWorkerId:matches.find(x=>x.canConsider)?.workerId??null,
    matches,
    nextStep:matches.some(x=>x.canConsider)?"assign":
      matches.length?"register-and-test":"search-and-build",
  };
}
export function catalogOverview(state: OpsState) {
  const workers=WORKER_BLUEPRINTS.map(b=>{
    const registered=state.workers[b.id];
    return {...structuredClone(b),
      registryStage:registered?.stage??"unregistered",
      version:registered?.contract.version??null,
      testMeasurements:registered?state.measurements.filter(m=>m.workerId===b.id&&m.version===registered.contract.version).length:0,
      activeInstances:null as number|null,
    };
  });
  const extras=Object.values(state.workers).filter(r=>!WORKER_BLUEPRINTS.some(b=>b.id===r.contract.id))
    .map(r=>({id:r.contract.id,name:r.contract.name,group:"maatwerk" as const,specialization:r.contract.specialization,
      taskKinds:r.contract.taskKinds,suggestedModel:r.contract.modelPolicy.preferred,
      requiredCapabilities:r.contract.tools,lifecycle:"design-only" as const,
      registryStage:r.stage,version:r.contract.version,
      testMeasurements:state.measurements.filter(m=>m.workerId===r.contract.id&&m.version===r.contract.version).length,
      activeInstances:null as number|null}));
  return {workers:[...workers,...extras],counts:{
    blueprints:WORKER_BLUEPRINTS.length,registered:Object.keys(state.workers).length,
    ready:Object.values(state.workers).filter(w=>w.stage==="ready").length,
    active:null as number|null,
  },note:"Workers in de catalogus zijn ontwerpen, geen actieve of geteste processen. Actieve instanties zijn nog niet meetbaar."};
}

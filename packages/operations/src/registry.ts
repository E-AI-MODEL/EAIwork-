import { applyMissionEvent, type MissionEvent, type MissionRecord } from "./missions.ts";
/**
 * Worker contracts and quality control. This is a separate operations model:
 * it never changes the authority or evidence status of EAIwork atoms.
 * All event payloads originate from a trusted authenticated controller, not a model.
 */
export type OpsActor = { kind: "person" | "system" | "check"; id: string };
export type WorkerStage = "candidate" | "ready" | "quarantined" | "disabled" | "superseded";
export interface WorkerContract {
  id: string;
  version: string;
  name: string;
  specialization: string;
  taskKinds: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  tools: string[];
  requestedPermissions: string[];
  modelPolicy: { preferred: "small" | "medium" | "large" | "deterministic" | "auto"; fallback?: string };
  testSuite: string;
  stopConditions: string[];
  recipe?:{kind:"builtin-compose";steps:["text-normalize","text-metrics"]};
}
export interface WorkerRecord {
  contract: WorkerContract;
  stage: WorkerStage;
  registeredAt: string;
  releasedAt?: string;
  releaseEvidence?: string;
}
export interface QualityMeasurement {
  id: string;
  workerId: string;
  version: string;
  taskKind: string;
  dataset: string;
  suiteVersion: string;
  cohort: string;
  metric: string;
  numerator: number;
  denominator: number;
  elapsedMs?: number;
  cost?: number;
  measuredAt: string;
  evidenceRef: string;
}
export interface RepairAttempt {
  candidateVersion: string;
  diagnosis: string;
  changeRef: string;
  suiteVersion: string;
  resultRef: string;
  passed: boolean;
  at: string;
}
export interface Defect {
  id: string;
  workerId: string;
  version: string;
  reason: string;
  severity: "quality" | "security";
  state: "open" | "human-required" | "resolved" | "decided";
  attempts: RepairAttempt[];
  decision?: { choice: "replace" | "rebuild" | "manual" | "pause" | "disable"; rationale: string; by: string; at: string };
}
export type OpsEvent =
  | MissionEvent
  | { type: "worker.register"; contract: WorkerContract }
  | { type: "worker.release"; id: string; version?: string; evidenceRef: string }
  | { type: "worker.activate-version"; id: string; version: string; rationale: string }
  | { type: "worker.quarantine"; id: string; reason: string }
  | { type: "quality.record"; measurement: QualityMeasurement }
  | { type: "defect.open"; id: string; workerId: string; reason: string; severity: "quality" | "security" }
  | { type: "repair.record"; defectId: string; attempt: RepairAttempt }
  | { type: "human.decide"; defectId: string; choice: "replace" | "rebuild" | "manual" | "pause" | "disable"; rationale: string };
export interface OpsEnvelope { id: string; at: string; actor: OpsActor; event: OpsEvent }
export interface OpsState { workers: Record<string, WorkerRecord>; workerVersions: Record<string, Record<string, WorkerRecord>>; measurements: QualityMeasurement[]; defects: Record<string, Defect>; missions: Record<string, MissionRecord>; history: OpsEnvelope[] }
export const emptyOps = (): OpsState => ({ workers: {}, workerVersions: {}, measurements: [], defects: {}, missions: {}, history: [] });
const fail = (message: string): never => { throw new Error(message); };
const meaningful = (s: unknown, label: string, max = 512): string => {
  if (typeof s !== "string" || !s.trim() || s.length > max) return fail(label + " is missing or invalid");
  return s.trim();
};
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const positiveInt = (v: unknown, name: string) => {
  if (!Number.isSafeInteger(v) || Number(v) < 0) fail(name + " must be a non-negative integer");
};
const requireHuman = (actor: OpsActor) => { if (actor.kind !== "person") fail("human decision required"); };
const requireTrustedTest = (actor: OpsActor) => {
  if (actor.kind !== "system" && actor.kind !== "check") fail("measurement must come from a trusted check or system");
};
/**
 * The public reducer stays pure. OpsStore uses stageOps for a copy of mutable
 * domains only, leaving the event history untouched until fsync commits.
 */
export function applyOps(current: OpsState, envelope: OpsEnvelope): OpsState {
  return transitionOps(current,envelope,undefined,true);
}
export function stageOps(
  current:OpsState,envelope:OpsEnvelope,seenIds:ReadonlySet<string>,
  verifiedJournalReplay=false,
):OpsState {
  return transitionOps(current,envelope,seenIds,false,verifiedJournalReplay);
}
function transitionOps(
  current:OpsState,envelope:OpsEnvelope,seenIds:ReadonlySet<string>|undefined,
  cloneHistory:boolean,verifiedJournalReplay=false,
):OpsState {
  if (!plain(envelope) || !plain(envelope.actor) || !plain(envelope.event)) fail("invalid operations envelope");
  meaningful(envelope.id, "event id", 128); meaningful(envelope.at, "event time", 64);
  meaningful(envelope.actor.id, "actor id", 128);
  if (!["person","system","check"].includes(envelope.actor.kind)) fail("invalid actor");
  const e = envelope.event;
  if (seenIds ? seenIds.has(envelope.id) : current.history.some(x=>x.id===envelope.id))
    fail("duplicate event id");
  // Clone only the domain that this event is allowed to change. Shared
  // domains stay read-only; the state is committed only after the disk write.
  const missionEvent=e.type.startsWith("mission.")||e.type.startsWith("task.");
  const workerEvent=[
    "worker.register","worker.release","worker.activate-version","worker.quarantine",
  ].includes(e.type);
  const defectEvent=["defect.open","repair.record","human.decide"].includes(e.type);
  const qualityEvent=e.type==="quality.record";
  const knownEvent=missionEvent||workerEvent||defectEvent||qualityEvent;
  // A mission event can only change one mission; copy the dictionary and that
  // one record, not every unrelated mission and all its task results.
  const copyAffectedMission=():OpsState["missions"]=>{
    const copy={...current.missions};
    if("missionId" in e && typeof e.missionId==="string" && current.missions[e.missionId])
      copy[e.missionId]=structuredClone(current.missions[e.missionId]);
    return copy;
  };
  const state:OpsState = cloneHistory ? structuredClone(current) : {
    workers:workerEvent||defectEvent||!knownEvent?structuredClone(current.workers):current.workers,
    workerVersions:workerEvent||defectEvent||!knownEvent?structuredClone(current.workerVersions):current.workerVersions,
    measurements:qualityEvent?current.measurements.slice():!knownEvent?structuredClone(current.measurements):current.measurements,
    defects:defectEvent||!knownEvent?structuredClone(current.defects):current.defects,
    missions:missionEvent?copyAffectedMission():!knownEvent?structuredClone(current.missions):current.missions,
    // Do not mutate this shared array until the journal write is durable.
    history:current.history,
  };
  if (e.type === "mission.create" || e.type === "mission.extend" || e.type === "mission.release.propose" || e.type === "mission.release.review" || e.type === "mission.pause" || e.type === "mission.resume" ||
      e.type === "task.started" || e.type === "task.lease.claim" || e.type === "task.lease.renew" || e.type === "task.lease.expire" || e.type === "task.completed" || e.type === "task.failed" || e.type === "task.recover" || e.type === "mission.gate.resolve" || e.type === "task.retry" || e.type === "mission.automation.start" || e.type === "mission.automation.stop") {
    applyMissionEvent(state.missions,e,envelope.actor,envelope.at,verifiedJournalReplay);
  } else if (e.type === "worker.register") {
    requireHuman(envelope.actor);
    const c = e.contract;
    if (!plain(c) || !/^[a-z][a-z0-9-]{2,63}$/.test(c.id) || !/^\d+\.\d+\.\d+$/.test(c.version)) fail("invalid worker id or version");
    meaningful(c.name, "name"); meaningful(c.specialization, "specialization");
    meaningful(c.testSuite, "test suite");
    if (!Array.isArray(c.taskKinds) || !c.taskKinds.length || !c.taskKinds.every(x=>typeof x==="string"&&x.trim())) fail("missing task kinds");
    if (!plain(c.inputSchema) || !plain(c.outputSchema)) fail("schemas required");
    if (!Array.isArray(c.tools) || !c.tools.every(x=>typeof x==="string")) fail("invalid tools");
    if (!Array.isArray(c.requestedPermissions) || !c.requestedPermissions.every(x=>typeof x==="string")) fail("invalid permissions");
    if (!Array.isArray(c.stopConditions) || !c.stopConditions.length) fail("stop conditions required");
    if (!plain(c.modelPolicy) || !["small","medium","large","deterministic","auto"].includes(String(c.modelPolicy.preferred))) fail("invalid model policy");
    if(c.recipe!==undefined){
      if(!plain(c.recipe)||c.recipe.kind!=="builtin-compose"||
         !Array.isArray(c.recipe.steps)||JSON.stringify(c.recipe.steps)!==JSON.stringify(["text-normalize","text-metrics"])||
         JSON.stringify(c.taskKinds)!==JSON.stringify(["text-inspect"])||
         c.modelPolicy.preferred!=="deterministic"||
         c.testSuite!=="builtin-compose-fixture-v1" ||
         c.tools.length!==0||c.requestedPermissions.length!==0)
        fail("invalid safe worker recipe");
    }
    state.workerVersions[c.id]??={};
    if (state.workerVersions[c.id][c.version]) fail("worker version already registered");
    const candidate:WorkerRecord={contract:structuredClone(c),stage:"candidate",registeredAt:envelope.at};
    state.workerVersions[c.id][c.version]=candidate;
    if(!state.workers[c.id])state.workers[c.id]=structuredClone(candidate);
  } else if (e.type === "worker.release") {
    requireHuman(envelope.actor);
    const active=state.workers[e.id];
    const version=e.version??active?.contract.version;
    const w=version?state.workerVersions[e.id]?.[version]:undefined;
    if(!w)fail("unknown worker version");
    if(w.stage!=="candidate")fail("only a candidate can be released");
    meaningful(e.evidenceRef,"test evidence");
    const validTest=state.history.some(row=>{
      const event=row.event;
      if(event.type!=="quality.record"||row.actor.kind!=="check")return false;
      const m=event.measurement;
      return m.workerId===e.id && m.version===w.contract.version &&
        m.evidenceRef===e.evidenceRef && w.contract.taskKinds.includes(m.taskKind) &&
        m.suiteVersion===w.contract.testSuite &&
        m.metric==="fixture-pass" && m.denominator>=3 && m.numerator===m.denominator &&
        (w.contract.testSuite!=="builtin-fixture-v1" || 
          (row.actor.id==="check:builtins" && m.dataset==="builtin-fixture-v1" && 
           m.cohort==="fixed-fixtures"));
    });
    if(!validTest)fail("release requires a passed, trusted, matching test for this exact version");
    if(Object.values(state.defects).some(d=>d.workerId===e.id&&d.version===w.contract.version&&
        ["open","human-required"].includes(d.state)))
      fail("cannot release a version with unresolved defects");
    if(active && active.contract.version!==w.contract.version) {
      // Keep old disabled/quarantined state, but demote a healthy prior release.
      if(active.stage==="ready")active.stage="superseded";
      state.workerVersions[e.id][active.contract.version]=structuredClone(active);
    }
    w.stage="ready";w.releasedAt=envelope.at;w.releaseEvidence=e.evidenceRef;
    state.workerVersions[e.id][w.contract.version]=structuredClone(w);
    state.workers[e.id]=structuredClone(w);
    // This changes active registration, never grants external runtime rights.
  } else if(e.type==="worker.activate-version"){
    requireHuman(envelope.actor);
    meaningful(e.rationale,"activation rationale");
    const w=state.workerVersions[e.id]?.[e.version];
    if(!w||w.stage!=="superseded"||!w.releaseEvidence)fail("version is not eligible for rollback");
    if(Object.values(state.defects).some(d=>d.workerId===e.id&&d.version===e.version&&
        ["open","human-required"].includes(d.state)))fail("cannot roll back to an unresolved defective version");
    const active=state.workers[e.id];
    if(active && active.contract.version!==e.version) {
      if(active.stage==="ready")active.stage="superseded";
      state.workerVersions[e.id][active.contract.version]=structuredClone(active);
    }
    w.stage="ready";
    state.workerVersions[e.id][e.version]=structuredClone(w);
    state.workers[e.id]=structuredClone(w);
  } else if (e.type === "worker.quarantine") {
    if (envelope.actor.kind === "person" || envelope.actor.kind === "system" || envelope.actor.kind === "check") {
      const w=state.workers[e.id]; if (!w) fail("unknown worker");
      meaningful(e.reason,"reason");
      w.stage="quarantined";
      state.workerVersions[e.id][w.contract.version]=structuredClone(w);
    }
  } else if (e.type === "quality.record") {
    requireTrustedTest(envelope.actor);
    const m=e.measurement; if (!plain(m)) fail("missing measurement");
    const w=state.workerVersions[m.workerId]?.[m.version];
    if(!w)fail("measurement version mismatch");
    for (const field of ["id","taskKind","dataset","suiteVersion","cohort","metric","measuredAt","evidenceRef"] as const) meaningful(m[field],field);
    positiveInt(m.numerator,"numerator"); positiveInt(m.denominator,"denominator");
    if (m.numerator>m.denominator || m.denominator===0) fail("invalid measurement fraction");
    if (m.elapsedMs!==undefined && (!Number.isFinite(m.elapsedMs)||m.elapsedMs<0)) fail("invalid elapsed time");
    if (m.cost!==undefined && (!Number.isFinite(m.cost)||m.cost<0)) fail("invalid cost");
    if (state.measurements.some(x=>x.id===m.id)) fail("duplicate measurement");
    state.measurements.push(structuredClone(m));
  } else if (e.type === "defect.open") {
    if (envelope.actor.kind === "person" || envelope.actor.kind === "system" || envelope.actor.kind === "check") {
      if (state.defects[e.id]) fail("duplicate defect");
      const w=state.workers[e.workerId]; if (!w) fail("unknown worker");
      meaningful(e.reason,"reason"); meaningful(e.id,"defect id");
      if (!["quality","security"].includes(e.severity)) fail("invalid severity");
      state.defects[e.id]={id:e.id,workerId:e.workerId,version:w.contract.version,reason:e.reason,severity:e.severity,state:e.severity==="security"?"human-required":"open",attempts:[]};
      if(e.severity==="security"){
        w.stage="quarantined";
        state.workerVersions[e.workerId][w.contract.version]=structuredClone(w);
      }
    }
  } else if (e.type === "repair.record") {
    requireTrustedTest(envelope.actor);
    const d=state.defects[e.defectId]; if (!d || d.state!=="open") fail("defect is not eligible for automatic repair");
    if (d.attempts.length>=3) fail("repair limit reached");
    const a=e.attempt; if (!plain(a)) fail("invalid attempt");
    for (const field of ["candidateVersion","diagnosis","changeRef","suiteVersion","resultRef","at"] as const) meaningful(a[field],field);
    if (typeof a.passed!=="boolean") fail("repair test outcome required");
    if (d.attempts.some(x=>x.changeRef===a.changeRef||x.candidateVersion===a.candidateVersion)) fail("duplicate repair attempt");
    d.attempts.push(structuredClone(a));
    if (a.passed) {
      // Accepted test finding does not release the candidate version automatically.
      d.state="resolved";
    } else if (d.attempts.length===3) {
      d.state="human-required";
      if(state.workers[d.workerId]?.contract.version===d.version){
        state.workers[d.workerId].stage="quarantined";
        state.workerVersions[d.workerId][d.version]=structuredClone(state.workers[d.workerId]);
      }
    }
  } else if (e.type === "human.decide") {
    requireHuman(envelope.actor);
    const d=state.defects[e.defectId]; if (!d || d.state!=="human-required") fail("no pending human decision");
    if (!["replace","rebuild","manual","pause","disable"].includes(e.choice)) fail("invalid decision");
    meaningful(e.rationale,"rationale");
    d.decision={choice:e.choice,rationale:e.rationale,by:envelope.actor.id,at:envelope.at};
    d.state="decided";
    if(e.choice==="disable"){
      const version=state.workerVersions[d.workerId]?.[d.version];
      if(version)version.stage="disabled";
      if(state.workers[d.workerId]?.contract.version===d.version)
        state.workers[d.workerId].stage="disabled";
    }
    // No worker is automatically re-enabled; the scheduler must honor quarantine.
  } else {
    fail("unknown operations event");
  }
  if(cloneHistory)state.history.push(structuredClone(envelope));
  return state;
}
export function qualityOverview(state: OpsState, id: string) {
  const w=state.workers[id]; if (!w) fail("unknown worker");
  const measures=state.measurements.filter(m=>m.workerId===id&&m.version===w.contract.version);
  const groups = new Map<string,QualityMeasurement[]>();
  for (const m of measures) {
    const key=[m.metric,m.taskKind,m.dataset,m.cohort,m.suiteVersion].join("|");
    groups.set(key,[...(groups.get(key)??[]),m]);
  }
  return [...groups.entries()].map(([key,arr])=>{
    const n=arr.reduce((sum,m)=>sum+m.denominator,0);
    const hits=arr.reduce((sum,m)=>sum+m.numerator,0);
    return {key,count:n,success:n?hits/n:null,measuredAt:arr.at(-1)?.measuredAt,sourceRefs:arr.map(m=>m.evidenceRef)};
  });
}

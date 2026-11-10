import { applyMissionEvent, type MissionEvent, type MissionRecord } from "./missions.ts";
/**
 * Worker contracts and quality control. This is a separate operations model:
 * it never changes the authority or evidence status of EAIwork atoms.
 * All event payloads originate from a trusted authenticated controller, not a model.
 */
export type OpsActor = { kind: "person" | "system" | "check"; id: string };
export type WorkerStage = "candidate" | "ready" | "quarantined" | "disabled";
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
  | { type: "worker.release"; id: string; evidenceRef: string }
  | { type: "worker.quarantine"; id: string; reason: string }
  | { type: "quality.record"; measurement: QualityMeasurement }
  | { type: "defect.open"; id: string; workerId: string; reason: string; severity: "quality" | "security" }
  | { type: "repair.record"; defectId: string; attempt: RepairAttempt }
  | { type: "human.decide"; defectId: string; choice: "replace" | "rebuild" | "manual" | "pause" | "disable"; rationale: string };
export interface OpsEnvelope { id: string; at: string; actor: OpsActor; event: OpsEvent }
export interface OpsState { workers: Record<string, WorkerRecord>; measurements: QualityMeasurement[]; defects: Record<string, Defect>; missions: Record<string, MissionRecord>; history: OpsEnvelope[] }
export const emptyOps = (): OpsState => ({ workers: {}, measurements: [], defects: {}, missions: {}, history: [] });
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
export function applyOps(current: OpsState, envelope: OpsEnvelope): OpsState {
  if (!plain(envelope) || !plain(envelope.actor) || !plain(envelope.event)) fail("invalid operations envelope");
  meaningful(envelope.id, "event id", 128); meaningful(envelope.at, "event time", 64);
  meaningful(envelope.actor.id, "actor id", 128);
  if (!["person","system","check"].includes(envelope.actor.kind)) fail("invalid actor");
  const e = envelope.event;
  if (current.history.some(x => x.id === envelope.id)) fail("duplicate event id");
  const state: OpsState = structuredClone(current);
  if (e.type === "mission.create" || e.type === "mission.pause" || e.type === "mission.resume" ||
      e.type === "task.started" || e.type === "task.completed" || e.type === "task.failed" || e.type === "mission.gate.resolve") {
    applyMissionEvent(state.missions,e,envelope.actor,envelope.at);
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
    if (state.workers[c.id]) fail("worker id already registered; use a new id for a new version");
    state.workers[c.id] = {contract: structuredClone(c), stage:"candidate", registeredAt:envelope.at};
  } else if (e.type === "worker.release") {
    requireHuman(envelope.actor);
    const w=state.workers[e.id]; if (!w) fail("unknown worker");
    if (w.stage !== "candidate") fail("only a candidate can be released");
    meaningful(e.evidenceRef,"test evidence");
    const hasRecordedTest=state.measurements.some(m=>m.workerId===e.id&&m.version===w.contract.version&&m.evidenceRef===e.evidenceRef&&m.denominator>0);
    if (!hasRecordedTest) fail("release requires a recorded test for this exact version");
    w.stage="ready"; w.releasedAt=envelope.at; w.releaseEvidence=e.evidenceRef;
    // This is registration only. Runtime rights are still assigned by server authz.
  } else if (e.type === "worker.quarantine") {
    if (envelope.actor.kind === "person" || envelope.actor.kind === "system" || envelope.actor.kind === "check") {
      const w=state.workers[e.id]; if (!w) fail("unknown worker");
      meaningful(e.reason,"reason");
      w.stage="quarantined";
    }
  } else if (e.type === "quality.record") {
    requireTrustedTest(envelope.actor);
    const m=e.measurement; if (!plain(m)) fail("missing measurement");
    const w=state.workers[m.workerId]; if (!w || w.contract.version!==m.version) fail("measurement version mismatch");
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
      if (e.severity==="security") w.stage="quarantined";
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
      state.workers[d.workerId].stage="quarantined";
    }
  } else if (e.type === "human.decide") {
    requireHuman(envelope.actor);
    const d=state.defects[e.defectId]; if (!d || d.state!=="human-required") fail("no pending human decision");
    if (!["replace","rebuild","manual","pause","disable"].includes(e.choice)) fail("invalid decision");
    meaningful(e.rationale,"rationale");
    d.decision={choice:e.choice,rationale:e.rationale,by:envelope.actor.id,at:envelope.at};
    d.state="decided";
    if (e.choice==="disable") state.workers[d.workerId].stage="disabled";
    // No worker is automatically re-enabled; the scheduler must honor quarantine.
  } else {
    fail("unknown operations event");
  }
  state.history.push(structuredClone(envelope));
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

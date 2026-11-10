/**
 * Read-only view of old fixture records created by the former local launcher.
 * The original hash-chained journal is never edited or truncated.
 * Hide records only when their seed provenance matches the old launcher.
 */
import type {OpsState,OpsEnvelope} from "./registry.ts";

const demoMissions:Record<string,string>={
  "mission-demo-text":"Tekstproef met echte workers",
  "mission-demo-repo":"Zoek in de eigen repository",
  "mission-demo-compose":"Samengestelde worker uitvoeren",
  "mission-demo-automatic":"Automatische tekstverwerking uitproberen"
};
const demoWorkers=new Set(["text-normalize","text-metrics","repo-search","text-inspector"]);
const seededWorker=(id:string,record:{contract:{version:string;specialization:string;recipe?:{kind:string}}})=>
  demoWorkers.has(id)&&record.contract.version==="1.0.0"&&
  (record.contract.specialization==="Fixed local demonstration"||
   (id==="text-inspector"&&record.contract.recipe?.kind==="builtin-compose"));
const demoFixture=(ref:unknown)=>typeof ref==="string"&&ref.startsWith("demo-fixtures:");
export function legacyDemoIds(state:OpsState){
  const missions=new Set<string>();
  const workers=new Set<string>();
  const measurements=new Set<string>();
  for(const row of state.history){
    const e=row.event;
    // Only seed events from the old local demo actor qualify, not user-created
    // records that happen to reuse a familiar name or ID.
    if(row.actor.id==="person:demo"&&e.type==="mission.create"&&
      demoMissions[e.plan.id]===e.plan.title)missions.add(e.plan.id);
    if(row.actor.id==="person:demo"&&e.type==="worker.register"&&
      seededWorker(e.contract.id,{contract:e.contract}))workers.add(e.contract.id);
    if(row.actor.id==="check:builtins"&&e.type==="quality.record"&&
      demoFixture(e.measurement.evidenceRef))measurements.add(e.measurement.id);
  }
  return {missions,workers,measurements};
}
export function localStateWithoutDemo(state:OpsState):OpsState{
  const ids=legacyDemoIds(state);
  // A new user-authored version of the old worker ID should remain visible.
  const workers=Object.fromEntries(Object.entries(state.workers).filter(([id,record])=>
    !ids.workers.has(id)||!seededWorker(id,record)));
  const workerVersions=Object.fromEntries(Object.entries(state.workerVersions).map(([id,versions])=>[
    id,Object.fromEntries(Object.entries(versions).filter(([,record])=>
      !ids.workers.has(id)||!seededWorker(id,record)))
  ]).filter(([,versions])=>Object.keys(versions as object).length>0));
  const measurements=state.measurements.filter(m=>
    !ids.measurements.has(m.id)&&!demoFixture(m.evidenceRef));
  const missions=Object.fromEntries(Object.entries(state.missions).filter(([id])=>!ids.missions.has(id)));
  const defects=Object.fromEntries(Object.entries(state.defects).filter(([,d])=>
    !ids.workers.has(d.workerId)||workers[d.workerId]));
  const hidden=(row:OpsEnvelope):boolean=>{
    const e=row.event;
    if(e.type==="mission.create")return ids.missions.has(e.plan.id);
    if("missionId" in e&&typeof e.missionId==="string"&&ids.missions.has(e.missionId))return true;
    if(e.type==="worker.register")return ids.workers.has(e.contract.id)&&
      seededWorker(e.contract.id,{contract:e.contract});
    if(e.type==="worker.release")return ids.workers.has(e.id)&&demoFixture(e.evidenceRef);
    if(e.type==="quality.record")return ids.measurements.has(e.measurement.id);
    if(e.type==="worker.quarantine"||e.type==="worker.activate-version")
      return ids.workers.has(e.id)&&!workers[e.id];
    if(e.type==="defect.open"||e.type==="repair.record"||e.type==="human.decide"){
      const defectId=e.type==="defect.open"?e.id:e.defectId;
      return !!state.defects[defectId]&&!defects[defectId];
    }
    return false;
  };
  return {...state,workers,workerVersions,measurements,missions,defects,
    history:state.history.filter(row=>!hidden(row))};
}

/**
 * One read-only, source-backed view of a mission's production process.
 *
 * Inspired by Shadowseed Pro's application orchestration and production
 * acceptance separation. We do not import Shadowseed's Gate/seed authority,
 * model memory, sessions or UI code into EAIwork.
 *
 * This projection never changes operations, grants permission, claims a task,
 * marks content correct, or authorizes publication.
 */
import type {OpsState} from "./registry.ts";
import {blockingConstraints} from "./missions.ts";
import {selectWorker,type RuntimeInventory} from "./selector.ts";

export type LineStageId="plan"|"workers"|"execute"|"review"|"release";
export type LineStatus="recorded"|"ready"|"running"|"waiting"|"blocked"|"needs-review"|"not-verified";
export interface LineStage {
  id:LineStageId;
  label:string;
  status:LineStatus;
  detail:string;
  taskIds:string[];
}
export interface NextOperatorAction {
  kind:"review-task"|"review-condition"|"inspect-worker"|"run-ready-task"|"inspect-result"|"wait"|"inspect-plan";
  actor:"person"|"worker";
  target:"uitvoering"|"hitl"|"registratie"|"planner"|"bewijs";
  label:string;
  reason:string;
}
export interface ProductionLineMission {
  id:string;
  title:string;
  revision:number;
  tasks:{total:number;queued:number;running:number;done:number;failed:number};
  stages:LineStage[];
  nextAction:NextOperatorAction;
  publication:{allowed:false;status:"not-verified";reason:string};
  releaseDossier?:{revision:number;repository:string;commitSha:string;
    artifactPath:string;artifactSha256:string;ciRunUrl:string;
    checkNames:string[];submittedBy:string;
    reviewDecision:"awaiting-review"|"changes-requested"|"external-verification-needed";
    reviewedBy:string|null;
    ciVerification:"unverified"|"github-confirmed";
    ciObservedAt:string|null;
    ciAttempt:number|null;
    byteVerification:"unverified"|"local-bytes-matched";
    byteCheckedAt:string|null;
    byteSize:number|null;
    artifactOriginVerified:false;
  };
}
export interface ProductionLineView {
  schema:"eai-production-line-v1";
  source:"verified-operations-state";
  generatedFrom:"operations-journal";
  operationsJournalVerified:boolean;
  independentOperationsWitness:false;
  releaseGate:"not-implemented";
  missions:ProductionLineMission[];
  summary:{missions:number;technicalCompletions:number;runningTasks:number;humanReviews:number};
  note:string;
}
const ACTIONS={
  task:{kind:"review-task",actor:"person",target:"uitvoering",label:"Beoordeel de mislukte taak",reason:"Een eerdere poging mag niet stilzwijgend opnieuw worden gestart."},
  constraint:{kind:"review-condition",actor:"person",target:"hitl",label:"Beoordeel de open voorwaarde",reason:"De oorspronkelijke opdracht verhindert dat deze taak alvast verdergaat."},
  worker:{kind:"inspect-worker",actor:"person",target:"registratie",label:"Controleer worker en contract",reason:"Er is geen toegelaten, beschikbare adapter voor een geplande taak."},
  running:{kind:"wait",actor:"worker",target:"uitvoering",label:"Volg de lopende uitvoering",reason:"De actuele taakclaim moet eerst afgerond of beoordeeld worden."},
  execute:{kind:"run-ready-task",actor:"person",target:"uitvoering",label:"Bekijk de volgende uitvoerbare taak",reason:"Een taak kan op basis van de huidige afhankelijkheden voor uitvoering worden voorgedragen. Starten vraagt afzonderlijke toestemming."},
  result:{kind:"inspect-result",actor:"person",target:"bewijs",label:"Controleer resultaat en herkomst",reason:"Technische voltooiing bewijst de inhoud niet en geeft geen publicatierecht."},
  plan:{kind:"inspect-plan",actor:"person",target:"planner",label:"Bekijk het werkplan",reason:"Controleer afhankelijkheden en voorwaarden voordat de uitvoering verdergaat."},
} as const satisfies Record<string,NextOperatorAction>;
const count=(tasks:Array<{status:string}>,status:string)=>tasks.filter(t=>t.status===status).length;
export function productionLineView(
  state:OpsState,runtime:RuntimeInventory,
  operationsJournalVerified:boolean,
):ProductionLineView {
  const missions=Object.values(state.missions)
    .sort((a,b)=>a.plan.id.localeCompare(b.plan.id))
    .map(mission=>{
      const specs=mission.plan.tasks;
      const records=specs.map(t=>mission.tasks[t.id]);
      const totals={total:records.length,queued:count(records,"queued"),
        running:count(records,"running"),done:count(records,"done"),
        failed:count(records,"failed")};
      const pending=specs.filter(t=>mission.tasks[t.id].status==="queued"||
        mission.tasks[t.id].status==="running");
      const constrained=pending.filter(t=>blockingConstraints(mission,t.id).length>0);
      const workers=specs.filter(t=>mission.tasks[t.id].status==="queued").map(t=>({
        task:t,selection:selectWorker({taskKind:t.taskKind},state,runtime),
      }));
      const missing=workers.filter(v=>!v.selection.selectedWorkerId);
      const ready=workers.filter(v=>!!v.selection.selectedWorkerId &&
        !mission.paused &&
        blockingConstraints(mission,v.task.id).length===0 &&
        v.task.dependsOn.every(id=>mission.tasks[id]?.status==="done"));
      const defectWorkers=new Set(Object.values(state.defects)
        .filter(d=>["open","human-required"].includes(d.state))
        .map(d=>d.workerId));
      const affected=specs.filter(t=>defectWorkers.has(mission.tasks[t.id].run?.workerId??"") ||
        Object.values(state.workers).some(w=>defectWorkers.has(w.contract.id)&&
          w.contract.taskKinds.includes(t.taskKind)));
      const allDone=totals.done===totals.total;
      const anyBlocked=constrained.length>0||missing.length>0||affected.length>0;
      const action:NextOperatorAction=totals.failed?ACTIONS.task:
        constrained.length?ACTIONS.constraint:
        affected.length||missing.length?ACTIONS.worker:
        totals.running?ACTIONS.running:
        allDone?ACTIONS.result:
        ready.length?ACTIONS.execute:ACTIONS.plan;
      const planStage:LineStage={id:"plan",label:"Werkplan",status:"recorded",
        detail:"Revisie "+mission.revision+" is vastgelegd. De inhoudelijke volledigheid van de opdracht is niet bewezen.",
        taskIds:specs.map(t=>t.id)};
      const workerStage:LineStage={id:"workers",label:"Workers",
        status:missing.length||affected.length?"blocked":"ready",
        detail:missing.length||affected.length?
          "Voor "+(missing.length+affected.length)+" taaktoewijzingen is controle nodig.":
          "Voor de nog geplande taken zijn workerkandidaten geregistreerd. De uitvoerder controleert rechten opnieuw.",
        taskIds:[...new Set([...missing.map(x=>x.task.id),...affected.map(t=>t.id)])]};
      const executing:LineStage={id:"execute",label:"Uitvoering",
        status:totals.failed?"needs-review":totals.running?"running":
          allDone?"recorded":mission.paused||anyBlocked?"blocked":
          ready.length?"ready":"waiting",
        detail:totals.done+" van "+totals.total+" taken technisch afgerond. "+
          totals.running+" bezig, "+totals.failed+" mislukt. Een taakuitvoer is nog geen bronbewijs.",
        taskIds:specs.filter(t=>mission.tasks[t.id].status!=="done").map(t=>t.id)};
      const reviewStage:LineStage={id:"review",label:"Controle en menselijke besluiten",
        status:totals.failed||constrained.length||affected.length?"needs-review":
          allDone?"needs-review":"waiting",
        detail:totals.failed||constrained.length||affected.length?
          "Mislukte pogingen, bronvoorwaarden of workerproblemen vragen beoordeling.":
          allDone?"Alle taken technisch afgerond; inhoudelijke controle ontbreekt nog.":
            "Er is nog geen volledig technisch resultaat om inhoudelijk te beoordelen.",
        taskIds:[...new Set([...specs.filter(t=>mission.tasks[t.id].status==="failed").map(t=>t.id),
          ...constrained.map(t=>t.id),...affected.map(t=>t.id)])]};
      const dossier=mission.releaseDossier?.revision===mission.revision?
        mission.releaseDossier:undefined;
      const releaseStage:LineStage={id:"release",label:"Opleverdossier",
        status:dossier?"needs-review":"not-verified",
        detail:dossier?
          dossier.artifactObservation?
            "De geüploade bestandsbytes komen overeen met de opgegeven SHA-256. Herkomst uit CI, licentie en bruikbaarheid zijn niet gecontroleerd.":
          dossier.ciObservation?
            "GitHub bevestigt de opgegeven CI-run. De bestandsbytes, herkomst en licentie zijn nog niet gecontroleerd.":
            "Kandidaat en aangeleverde verwijzingen zijn vastgelegd. De CI-run, bestandsbytes en licentie zijn nog niet gecontroleerd.":
          "Nog geen opleverdossier met een exacte commit, artefacthash en testverwijzingen.",
        taskIds:[]};
      return {id:mission.plan.id,title:mission.plan.title,revision:mission.revision,
        tasks:totals,stages:[planStage,workerStage,executing,reviewStage,releaseStage],
        nextAction:totals.failed||constrained.length||missing.length||affected.length?
          action:allDone&&dossier?
          {kind:"inspect-result" as const,actor:"person" as const,target:"bewijs" as const,
            label:dossier.review?"Bekijk de beoordeling":"Laat het opleverdossier beoordelen",
            reason:"De aangeleverde testgegevens zijn nog geen onafhankelijk gecontroleerd releasebewijs."}:
          action,
        publication:{allowed:false,status:"not-verified",
          reason:"CI, artefact en licentie zijn niet onafhankelijk gecontroleerd. Publicatie is uitgeschakeld."},
        ...(dossier?{releaseDossier:{
          revision:dossier.revision,repository:dossier.candidate.repository,
          commitSha:dossier.candidate.commitSha,
          artifactPath:dossier.candidate.artifactPath,
          artifactSha256:dossier.candidate.artifactSha256,
          ciRunUrl:dossier.candidate.ciRunUrl,
          checkNames:[...dossier.candidate.checkNames],
          submittedBy:dossier.submittedBy,
          reviewDecision:dossier.review?.decision??"awaiting-review",
          reviewedBy:dossier.review?.by??null,
          ciVerification:dossier.ciObservation?"github-confirmed":"unverified",
          ciObservedAt:dossier.ciObservation?.observedAt??null,
          ciAttempt:dossier.ciObservation?.attempt??null,
          byteVerification:dossier.artifactObservation?"local-bytes-matched":"unverified",
          byteCheckedAt:dossier.artifactObservation?.checkedAt??null,
          byteSize:dossier.artifactObservation?.sizeBytes??null,
          artifactOriginVerified:false,
        }}:{}),
      };
    });
  return {schema:"eai-production-line-v1",source:"verified-operations-state",
    generatedFrom:"operations-journal",operationsJournalVerified,
    independentOperationsWitness:false,releaseGate:"not-implemented",
    missions,summary:{
      missions:missions.length,
      technicalCompletions:missions.filter(m=>m.tasks.done===m.tasks.total).length,
      runningTasks:missions.reduce((n,m)=>n+m.tasks.running,0),
      humanReviews:missions.filter(m=>m.nextAction.actor==="person"&&
        ["review-task","review-condition","inspect-worker","inspect-result"].includes(m.nextAction.kind)).length,
    },
    note:"De productielijn is een afgeleide weergave van werkelijk geregistreerde events. Sturing gebruikt bestaande beveiligde routes. Geen automatische codebouw of publicatie.",
  };
}

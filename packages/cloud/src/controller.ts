/**
 * First browser-only EAIwork vertical slice.
 * Reuses the native mission reducer, worker registry, selection and Builder.
 * No arbitrary code, shell, repository access, models, or automatic release.
 */
import {applyOps,emptyOps,type OpsState,type OpsEnvelope,type OpsEvent} from "../../operations/src/registry.ts";
import {proposeComposedWorker} from "../../operations/src/builder.ts";
import {evaluateComposedFixture,runPureTextAdapter,safeComposition} from "../../operations/src/pure-text.ts";
import {missionProgress,blockingConstraints} from "../../operations/src/missions.ts";
import {selectWorker} from "../../operations/src/selector.ts";
import {inspectMissionWorkerNeedsWithInventory} from "../../operations/src/worker-needs.ts";

export type CloudAction=
  | {type:"create";title:string;text:string}
  | {type:"submit";instruction:string;sourceText?:string}
  | {type:"prepare";missionId:string}
  | {type:"release";missionId:string}
  | {type:"run";missionId:string};

const idPattern=/^mission-[a-z0-9-]{8,55}$/;
const inventory={adapterIds:["text-inspector"],capabilities:[],grantedPermissions:[],
  supportedModelSizes:["deterministic"] as const};
const person=(actorId:string)=>({kind:"person" as const,id:actorId});
/** A bounded, explicit intent check. Never interpret a title like "build" as executable code. */
export function cloudRequestKind(instruction:string,sourceText=""):"text-inspect"|"request-review"{
  const text=instruction.toLowerCase();
  const safeTextIntent=/\b(inspecteer|tekstinspectie|tel(?:len)?\s+(?:het\s+)?(?:aantal\s+)?(?:woorden|tekens|regels)|hoeveel\s+(?:woorden|tekens|regels)|analyseer\s+(?:de|dit|mijn|een)\s+tekst|controleer\s+(?:de|dit|mijn|een)\s+tekst)\b/i;
  const differentTask=/\b(bouw|bouwen|maak|maken|ontwikkel|programmeer|publiceer|verstuur|mail|verwijder|github|dashboard|website|app|code|deploy|worker|shell|terminal)\b/i;
  return sourceText.trim()&&safeTextIntent.test(text)&&!differentTask.test(text)
    ?"text-inspect":"request-review";
}
const checker={kind:"check" as const,id:"check:builtins"};
const event=(actor:OpsEnvelope["actor"],e:OpsEvent):OpsEnvelope=>
  ({id:"event-"+crypto.randomUUID(),at:new Date().toISOString(),actor,event:e});
const deny=(message:string):never=>{throw new Error(message)};
export function validateCloudAction(value:unknown):CloudAction {
  if(!value||typeof value!=="object"||Array.isArray(value))return deny("Ongeldige opdracht");
  const a=value as Record<string,unknown>;
  if(a.type==="submit"){
    if(Object.keys(a).some(k=>!["type","instruction","sourceText"].includes(k))||
      typeof a.instruction!=="string"||!a.instruction.trim()||a.instruction.length>1500||
      (a.sourceText!==undefined&&
        (typeof a.sourceText!=="string"||a.sourceText.length>10000)))
      return deny("Beschrijf de opdracht in maximaal 1500 tekens en voeg eventueel een tekst toe");
    return {type:"submit",instruction:a.instruction.trim(),
      ...(typeof a.sourceText==="string"?{sourceText:a.sourceText}:{})};
  }
  if(a.type==="create"){
    if(Object.keys(a).some(k=>!["type","title","text"].includes(k))||
       typeof a.title!=="string"||!a.title.trim()||a.title.length>160||
       typeof a.text!=="string"||!a.text.trim()||a.text.length>12000)
      return deny("Titel of tekst ontbreekt of is te lang");
    return {type:"create",title:a.title.trim(),text:a.text};
  }
  if(["prepare","release","run"].includes(String(a.type))&&
     Object.keys(a).length===2&&typeof a.missionId==="string"&&idPattern.test(a.missionId))
    return a as CloudAction;
  return deny("Alleen de ondersteunde tekstproef is beschikbaar");
}
export function cloudView(state:OpsState) {
  const missions=Object.values(state.missions).slice(-30).reverse().map(m=>{
    const task=m.tasks["task-inspect"];
    const progress=missionProgress(m);
    const need=inspectMissionWorkerNeedsWithInventory(state,m.plan.id,{
      ...inventory,adapterIds:[...inventory.adapterIds],
      supportedModelSizes:[...inventory.supportedModelSizes],
    }).needs.find(n=>n.taskId===task?.spec.id)??null;
    return {id:m.plan.id,title:m.plan.title,createdAt:m.createdAt,
      revision:m.revision,progress,status:task?.status??"unknown",
      taskKind:task?.spec.taskKind??"unknown",
      requestedOutcome:m.plan.sourceInstruction??null,
      need:need?{status:need.status,reason:need.reason,workerId:need.workerId}:null,
      output:task?.run?.output??null,verification:task?.run?.verification??null,
      owner:m.createdBy};
  });
  const worker=state.workers["text-inspector"];
  return {missions,worker:worker?
    {id:worker.contract.id,version:worker.contract.version,stage:worker.stage,
      releaseEvidence:worker.releaseEvidence??null}:null,
    journalLength:state.history.length,
    note:"Uitvoering is niet hetzelfde als onafhankelijke inhoudelijke verificatie."};
}
/** A transition only proposes events. The Durable Object commits them together. */
export async function cloudTransition(state:OpsState,input:unknown,actorId:string):
  Promise<{events:OpsEnvelope[];result:Record<string,unknown>;next:OpsState}> {
  if(typeof actorId!=="string"||!/^person:[a-z0-9-]{5,70}$/.test(actorId))
    throw new Error("Verifieer eerst de gebruiker");
  if(state.history.length>160)throw new Error("Werklog is vol; export en beoordeling nodig");
  const action=validateCloudAction(input),events:OpsEnvelope[]=[];
  const push=(actor:OpsEnvelope["actor"],e:OpsEvent)=>events.push(event(actor,e));
  let result:Record<string,unknown>={};
  if(action.type==="create"||action.type==="submit"){
    if(Object.keys(state.missions).length>=30)throw new Error("Maximaal 30 opdrachten in deze proef");
    const id="mission-"+crypto.randomUUID().replaceAll("-","").slice(0,20);
    const isRequest=action.type==="submit";
    const kind=isRequest?cloudRequestKind(action.instruction,action.sourceText):"text-inspect";
    const instruction=isRequest?action.instruction:"Voer een deterministische tekstinspectie uit";
    const title=isRequest?instruction.split("\n")[0].slice(0,120):action.title;
    const inputText=isRequest?(action.sourceText||instruction):action.text;
    push(person(actorId),{type:"mission.create",plan:{
      id,title,goal:instruction,
      ...(isRequest?{sourceInstruction:instruction}:{}),
      tasks:[{id:"task-inspect",title:kind==="text-inspect"?"Tekstinspectie":"Nog niet ondersteunde opdracht",
        taskKind:kind,effect:"local",
        dependsOn:[],input:{text:inputText}}],
    }});
    result={missionId:id,stage:kind==="text-inspect"?"queued":"unsupported",
      taskKind:kind};
  }else{
    const m=state.missions[action.missionId];
    if(!m)throw new Error("Onbekende opdracht");
    if(m.createdBy!==actorId)throw new Error("Alleen de eigenaar kan deze opdracht wijzigen");
    const task=m.tasks["task-inspect"];
    if(!task||task.spec.taskKind!=="text-inspect"||
       task.spec.effect!=="local"||blockingConstraints(m,task.spec.id).length)
      throw new Error("Deze opdracht is niet geschikt voor deze lokale worker");
    if(action.type==="prepare"){
      if(task.status!=="queued"||m.paused||m.automation?.enabled)
        throw new Error("Opdracht is niet vrijgegeven voor workerbouw");
      if(state.workers["text-inspector"])
        throw new Error("Er bestaat al een worker. Bekijk de toelatingsstatus.");
      const proposal=proposeComposedWorker("text-inspector","Tekstinspectie");
      const check=evaluateComposedFixture(proposal.contract);
      if(check.numerator!==check.denominator||check.denominator<3)
        throw new Error("De werkelijke fixtures zijn niet geslaagd");
      push(person(actorId),{type:"worker.register",contract:proposal.contract});
      const evidenceRef="builtin-fixtures:"+crypto.randomUUID();
      push(checker,{type:"quality.record",measurement:{
        id:"measure-"+crypto.randomUUID(),workerId:proposal.contract.id,
        version:proposal.contract.version,taskKind:check.taskKind,dataset:check.dataset,
        suiteVersion:check.suiteVersion,cohort:check.cohort,metric:check.metric,
        numerator:check.numerator,denominator:check.denominator,
        measuredAt:new Date().toISOString(),evidenceRef,
      }});
      result={stage:"candidate-tested",workerId:"text-inspector",tests:check.denominator,
        approvalRequired:true};
    }else if(action.type==="release"){
      const w=state.workers["text-inspector"];
      if(w?.stage!=="candidate"||!safeComposition(w.contract))
        throw new Error("Geen passende geteste kandidaat voor toelating");
      const evidence=[...state.measurements].reverse().find(meas=>
        meas.workerId===w.contract.id&&meas.version===w.contract.version&&
        meas.suiteVersion===w.contract.testSuite&&
        meas.metric==="fixture-pass"&&meas.numerator===meas.denominator&&meas.denominator>=3);
      if(!evidence)throw new Error("Geteste versie of meetbewijs ontbreekt");
      push(person(actorId),{type:"worker.release",id:w.contract.id,
        version:w.contract.version,evidenceRef:evidence.evidenceRef});
      result={stage:"ready",workerId:w.contract.id,approvedBy:actorId};
    }else if(action.type==="run"){
      const w=state.workers["text-inspector"];
      if(w?.stage!=="ready"||!safeComposition(w.contract))
        throw new Error("Geen vrijgegeven, ondersteunde worker beschikbaar");
      if(task.status!=="queued"||m.paused||m.automation?.enabled)
        throw new Error("Opdracht is niet klaar voor uitvoering");
      const selected=selectWorker({taskKind:"text-inspect"},state,{
        adapterIds:[...inventory.adapterIds],capabilities:[],grantedPermissions:[],
        supportedModelSizes:["deterministic"],
      });
      if(selected.selectedWorkerId!==w.contract.id)
        throw new Error("De workerselectie geeft geen toestemming");
      const inputText=task.spec.input?.text;
      if(typeof inputText!=="string")throw new Error("Taaktekst ontbreekt");
      const input={text:inputText};
      const runId="run-"+crypto.randomUUID().replaceAll("-","").slice(0,20);
      const inputHash=await digest(input);
      const started=new Date().toISOString(),stamp=Date.now();
      const output=runPureTextAdapter("text-inspect",input);
      const outputHash=await digest(output);
      push({kind:"system",id:"system:mission-runner"},{type:"task.started",missionId:action.missionId,taskId:task.spec.id,
        run:{runId,workerId:w.contract.id,workerVersion:w.contract.version,
          adapterId:"text-inspect",inputHash,startedAt:started,verification:"not-evaluated"}});
      push({kind:"system",id:"system:mission-runner"},
        {type:"task.completed",missionId:action.missionId,taskId:task.spec.id,
          runId,finishedAt:new Date().toISOString(),elapsedMs:Math.max(0,Date.now()-stamp),
          output,outputHash});
      result={stage:"done",missionId:action.missionId,output,verification:"not-evaluated"};
    }
  }
  let next=state;
  for(const envelope of events)next=applyOps(next,envelope);
  // Side-effect-free, explicitly requested text inspection may reuse an
  // already released worker. No implicit building, release or external action.
  if(action.type==="submit"&&result.taskKind==="text-inspect"&&
     selectWorker({taskKind:"text-inspect"},next,{
       ...inventory,adapterIds:[...inventory.adapterIds],
       supportedModelSizes:[...inventory.supportedModelSizes],
     }).selectedWorkerId==="text-inspector"){
    const run=await cloudTransition(next,{type:"run",missionId:String(result.missionId)},actorId);
    events.push(...run.events);
    next=run.next;
    result={...result,stage:"done",execution:run.result};
  }
  return {events,result,next};
}
export async function digest(value:unknown):Promise<string>{
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  const hash=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
export {emptyOps};

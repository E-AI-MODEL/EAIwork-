/**
 * Experimental concurrent execution of TWO already-approved, independent
 * deterministic text jobs, each in a fresh bounded child process.
 *
 * This is not a distributed queue, a sandbox for arbitrary code or an
 * exactly-once protocol for external effects. Task starts are durably claimed
 * in the one local operations writer before each child begins.
 */
import {spawn} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import type {OpsStore} from "./store.ts";
import {blockingConstraints,missionProgress} from "./missions.ts";
import {selectWorker} from "./selector.ts";
import {builtinInventoryForState,evaluateBuiltin,inputFor} from "./execution.ts";
import type {OpsEvent} from "./registry.ts";

const MAX_CHILDREN=2;
const PURE_KINDS=new Set(["text-normalize","text-metrics"]);
const digest=(value:unknown)=>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const workerFile=fileURLToPath(new URL("./pure-text-child.ts",import.meta.url));
let activeSlots=0;
interface ChildOutput {
  ok:boolean;
  output?:Record<string,unknown>;
  errorCode?:"adapter-error"|"output-invalid"|"worker-unavailable";
}
function validOutput(kind:string,input:{text:string},output:unknown):output is Record<string,unknown>{
  if(!output||typeof output!=="object"||Array.isArray(output))return false;
  const data=output as Record<string,unknown>;
  if(typeof data.text!=="string"||data.text.length>12000)return false;
  if(kind==="text-normalize")
    return typeof data.changed==="boolean"&&Object.keys(data).sort().join(",")==="changed,text";
  return kind==="text-metrics" && data.text===input.text &&
    ["characters","words","lines"].every(key=>
      Number.isSafeInteger(data[key]) && Number(data[key])>=0) &&
    Object.keys(data).sort().join(",")==="characters,lines,text,words";
}
function inChild(kind:string,input:{text:string},timeoutMs:number):Promise<ChildOutput>{
  return new Promise(resolve=>{
    const bytes=JSON.stringify(input);
    if(Buffer.byteLength(bytes,"utf8")>13000){
      resolve({ok:false,errorCode:"output-invalid"});return;
    }
    let child:ReturnType<typeof spawn>;
    try{
      child=spawn(process.execPath,[
        "--max-old-space-size=64",workerFile,kind,
      ],{
        stdio:["pipe","pipe","pipe"],env:{},cwd:tmpdir(),windowsHide:true,
      });
    }catch{
      resolve({ok:false,errorCode:"worker-unavailable"});return;
    }
    let stdout="",tooLarge=false,timedOut=false,spawnError=false;
    child.stdout.on("data",(chunk:Buffer)=>{
      if(tooLarge)return;
      stdout+=chunk.toString("utf8");
      if(Buffer.byteLength(stdout,"utf8")>16384){
        tooLarge=true;child.kill("SIGKILL");
      }
    });
    // Do not echo task input, child stderr or environment into the log.
    child.stderr.on("data",()=>{});
    child.stdin.on("error",()=>{});
    child.on("error",()=>{spawnError=true});
    const timer=setTimeout(()=>{
      timedOut=true;child.kill("SIGKILL");
    },timeoutMs);
    child.on("close",(code)=>{
      clearTimeout(timer);
      if(spawnError||timedOut||code!==0){
        resolve({ok:false,errorCode:spawnError?"worker-unavailable":"adapter-error"});
        return;
      }
      if(tooLarge){resolve({ok:false,errorCode:"output-invalid"});return}
      let parsed:unknown;
      try{parsed=JSON.parse(stdout)}
      catch{resolve({ok:false,errorCode:"output-invalid"});return}
      if(!validOutput(kind,input,parsed)){
        resolve({ok:false,errorCode:"output-invalid"});return;
      }
      resolve({ok:true,output:parsed});
    });
    child.stdin.end(bytes);
  });
}
export interface ParallelLocalResult {
  missionId:string;
  claimed:string[];
  completed:string[];
  failed:string[];
  blocked:{taskId:string;reason:string}[];
  maxParallel:number;
  progress:ReturnType<typeof missionProgress>;
  note:string;
}
export async function runParallelPureText(
  store:OpsStore,missionId:string,maxParallel=2,timeoutMs=5000,
):Promise<ParallelLocalResult>{
  if(!Number.isInteger(maxParallel)||maxParallel<1||maxParallel>MAX_CHILDREN)
    throw new Error("parallel capacity must be 1-2");
  if(!Number.isInteger(timeoutMs)||timeoutMs<250||timeoutMs>15000)
    throw new Error("local child timeout must be 250-15000 ms");
  const first=store.snapshot();
  const mission=first.missions[missionId];
  if(!mission)throw new Error("unknown mission");
  if(mission.paused||mission.automation?.enabled)
    throw new Error("pause or stop automatic execution before parallel manual work");
  if(Object.values(mission.tasks).some(t=>t.status==="running"))
    throw new Error("review previously claimed work before starting parallel workers");

  const ready=mission.plan.tasks.filter(spec=>
    mission.tasks[spec.id].status==="queued" &&
    spec.dependsOn.every(dep=>mission.tasks[dep].status==="done") &&
    blockingConstraints(mission,spec.id).length===0);
  const report:ParallelLocalResult={missionId,claimed:[],completed:[],failed:[],
    blocked:[],maxParallel,progress:missionProgress(mission),
    note:"Independent, fixed local text workers in child processes. No external effects, model calls, automatic evidence promotion or general-purpose sandbox.",
  };
  const inventory=builtinInventoryForState(first);
  const selected:Array<{taskId:string;kind:string;input:{text:string};version:string}>=[];
  for(const spec of ready){
    if(selected.length>=maxParallel)break;
    if(!PURE_KINDS.has(spec.taskKind)||
       (spec.effect!==undefined&&spec.effect!=="local")){
      report.blocked.push({taskId:spec.id,reason:"not-a-pure-local-text-worker"});
      continue;
    }
    let input:{text:string};
    try{input=inputFor(mission,spec.id)}
    catch{report.blocked.push({taskId:spec.id,reason:"dependency-output-unavailable"});continue}
    const candidate=selectWorker({taskKind:spec.taskKind},first,inventory);
    const id=candidate.selectedWorkerId;
    const worker=id?first.workers[id]:undefined;
    if(!id||id!==spec.taskKind||!worker||worker.stage!=="ready"){
      report.blocked.push({taskId:spec.id,reason:"worker-not-admitted"});continue;
    }
    try{
      const fixture=evaluateBuiltin(id,worker.contract);
      if(fixture.numerator!==fixture.denominator)throw new Error("fixture failed");
    }catch{report.blocked.push({taskId:spec.id,reason:"worker-contract-not-trusted"});continue}
    selected.push({taskId:spec.id,kind:id,input,version:worker.contract.version});
  }
  if(!selected.length)return report;
  if(activeSlots+selected.length>MAX_CHILDREN)throw new Error("local worker capacity exhausted");
  activeSlots+=selected.length;
  const emit=(event:OpsEvent)=>store.append({
    id:"ops-"+randomUUID(),at:new Date().toISOString(),
    actor:{kind:"system",id:"system:mission-runner"},event,
  });
  const pending:Array<{
    taskId:string;runId:string;kind:string;version:string;
    startedMs:number;execution:Promise<ChildOutput>;
  }>=[];
  let claimFailure:unknown=null;
  try{
    for(const item of selected){
      const runId="run-"+randomUUID();
      try{
        emit({type:"task.started",missionId,taskId:item.taskId,run:{
          runId,workerId:item.kind,workerVersion:item.version,
          adapterId:item.kind,inputHash:digest(item.input),
          startedAt:new Date().toISOString(),verification:"not-evaluated",
        }});
      }catch(e){claimFailure=e;break}
      report.claimed.push(item.taskId);
      const startedMs=performance.now();
      // Start immediately after each durable claim. There is no await here:
      // independent child processes can genuinely overlap.
      pending.push({taskId:item.taskId,runId,kind:item.kind,version:item.version,
        startedMs,execution:inChild(item.kind,item.input,timeoutMs)});
    }
    const outcomes=await Promise.all(pending.map(item=>item.execution));
    for(let i=0;i<pending.length;i++){
      const item=pending[i],outcome=outcomes[i];
      const current=store.snapshot();
      const latest=current.missions[missionId];
      const attempt=latest?.tasks[item.taskId];
      if(!latest||attempt?.status!=="running"||attempt.run?.runId!==item.runId){
        report.blocked.push({taskId:item.taskId,reason:"claim-no-longer-current"});
        continue;
      }
      const admitted=!latest.paused &&
        current.workers[item.kind]?.stage==="ready" &&
        current.workers[item.kind]?.contract.version===item.version;
      const finishedAt=new Date().toISOString();
      const elapsedMs=Math.round(performance.now()-item.startedMs);
      if(!outcome.ok||!admitted){
        emit({type:"task.failed",missionId,taskId:item.taskId,runId:item.runId,
          finishedAt,elapsedMs,
          errorCode:!admitted?"worker-unavailable":outcome.errorCode??"adapter-error"});
        report.failed.push(item.taskId);
        continue;
      }
      const output=outcome.output!;
      emit({type:"task.completed",missionId,taskId:item.taskId,runId:item.runId,
        finishedAt,elapsedMs,output,outputHash:digest(output)});
      report.completed.push(item.taskId);
    }
    if(claimFailure)throw claimFailure;
    report.progress=missionProgress(store.snapshot().missions[missionId]);
    return report;
  }finally{
    activeSlots-=selected.length;
  }
}

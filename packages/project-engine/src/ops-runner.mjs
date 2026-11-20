// EAIgit read-only worker runner wired to the EXISTING EAIwork operations journal.
// No new data store, no model, repository writes, installs or publication.
import {createHash,randomUUID} from "node:crypto";
import {inventory,syntax,combine,sourceBinding} from "./engine.mjs";
const STEPS=["inventory","syntax","report"];
const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const counts=(step,result)=>{
 if(step==="inventory")return {checked:result.count,failed:0,unknown:result.skipped.length};
 if(step==="syntax")return {checked:result.checked,failed:result.failed,unknown:result.unknown};
 return {checked:result.checks.checked,failed:result.checks.failed,unknown:result.checks.unknown};
};
const outcome=(step,result)=>{
 if(step==="report")return ["needs-review","human-review"];
 if(step==="syntax"){
  if(result.failed)return ["needs-review","syntax-findings"];
  if(result.unknown)return ["needs-review","incomplete"];
 }
 return ["completed","ok"];
};
export function projectCheckHistory(store,runId){
 const verified=store.verify();
 if(!verified.ok)throw new Error("operations journal integrity failed");
 return store.snapshot().history.filter(row=>row.event.type==="project.check.record"&&row.event.runId===runId)
  .map(row=>({...row.event,eventId:row.id,at:row.at}));
}
/**
 * Explicit, local execution of three REAL deterministic project workers.
 * Project inputs are re-read when resuming and compared with the recorded hash.
 * A failed step can be attempted exactly once more, only with allowRetry=true.
 * No automatic crash retries. This is not a background scheduler.
 */
export async function runProjectCheck(store,folder,{
 goal="code",runId="eaigit-"+randomUUID(),allowRetry=false,environment=process.env
}={}){
 if(!store||typeof store.append!=="function"||typeof store.verify!=="function"||
    typeof folder!=="string"||!folder.trim()||!["site","app","code","docs"].includes(goal)||
    !/^[a-z0-9][a-z0-9-]{7,95}$/.test(runId))
  throw new Error("invalid EAIgit local project run");
 const source=sourceBinding(environment);
 const history=projectCheckHistory(store,runId);
 if(history.some(row=>JSON.stringify(row.source)!==JSON.stringify(source)))
  throw new Error("project source binding changed; start a new run");
 const outcomes={},executed=[],reused=[];
 const run={inventory:()=>inventory(folder,goal),syntax:()=>syntax(folder),
  report:()=>combine(outcomes.inventory,outcomes.syntax)};
 for(const step of STEPS){
  const previous=history.filter(row=>row.step===step);
  const latest=previous.at(-1);
  if(latest?.status==="failed"&&(!allowRetry||previous.length>=2))
    return {runId,source,status:"blocked",reason:previous.length>=2?"retry-limit":"explicit-retry-required",
      executed,reused,results:outcomes};
  let result;
  try{result=await run[step]();}
  catch(error){
   if(latest&&latest.status!=="failed")throw new Error("previous result could not be reproduced; start a new run");
   const attempt=previous.length+1;
   if(attempt>2)throw new Error("read-only retry limit exceeded");
   store.append({id:"eaigit-"+randomUUID(),at:new Date().toISOString(),
    actor:{kind:"check",id:"check:eaigit-local"},
    event:{type:"project.check.record",runId,step,status:"failed",attempt,
     source,resultSha256:hash({step,kind:"worker-error"}),detailCode:"worker-error",
     counts:{checked:0,failed:0,unknown:0}}});
   return {runId,source,status:"blocked",reason:"worker-error",failedStep:step,executed,reused,results:outcomes};
  }
  const fingerprint=hash(result);
  if(latest&&latest.status!=="failed"){
   if(fingerprint!==latest.resultSha256)
    return {runId,source,status:"blocked",reason:"source-or-worker-result-changed",
      changedStep:step,executed,reused,results:outcomes};
   reused.push(step);outcomes[step]=result;continue;
  }
  const [status,detailCode]=outcome(step,result);
  const attempt=previous.length+1;
  store.append({id:"eaigit-"+randomUUID(),at:new Date().toISOString(),
   actor:{kind:"check",id:"check:eaigit-local"},
   event:{type:"project.check.record",runId,step,status,attempt,source,
    resultSha256:fingerprint,detailCode,counts:counts(step,result)}});
  executed.push(step);outcomes[step]=result;
 }
 return {runId,source,status:"needs-human-review",executed,reused,results:outcomes,
  note:"Three real read-only workers completed. Source and results are recorded in the local EAIwork operations journal. Functionality, deployment and permissions are not verified."};
}

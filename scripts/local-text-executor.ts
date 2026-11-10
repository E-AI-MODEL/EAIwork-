/**
 * Standalone fixed-code executor for the local HTTP demonstration.
 * No tools, arbitrary code, model calls, file access or external actions.
 * The coordinator grants exactly one task at a time.
 */
import {runPureTextAdapter} from "../packages/operations/src/execution.ts";
import type {ExecutorJob,JobReference} from "../packages/operations/src/executor-channel.ts";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";

export type ExecutorOnceResult=
  {status:"idle"} |
  {status:"completed";missionId:string;taskId:string;runId:string};
const allowedUrl=(value:string):URL=>{
  const url=new URL(value);
  if(url.protocol!=="http:"||!["localhost","127.0.0.1","[::1]"].includes(url.hostname)||
     url.username||url.password||url.search||url.hash||
     (url.pathname!=="/"&&url.pathname!==""))
    throw new Error("executor demonstration accepts only a loopback HTTP server");
  return url;
};
export async function runExecutorOnce(baseUrl:string,token:string):Promise<ExecutorOnceResult>{
  const url=allowedUrl(baseUrl);
  if(typeof token!=="string"||token.length<32)throw new Error("invalid executor token");
  const post=async(path:string,body:unknown)=>{
    const response=await fetch(new URL(path,url),{
      method:"POST",redirect:"error",signal:AbortSignal.timeout(20000),
      headers:{"content-type":"application/json",authorization:"Bearer "+token},
      body:JSON.stringify(body),
    });
    return response;
  };
  const claim=await post("/executor/v1/claim",{});
  if(claim.status===204)return {status:"idle"};
  if(!claim.ok)throw new Error("executor claim rejected: "+claim.status);
  const job=await claim.json() as ExecutorJob;
  if(job.protocol!=="eai-local-executor-v1"||
     !["text-normalize","text-metrics"].includes(job.kind)||
     typeof job.input?.text!=="string"||job.input.text.length>12000||
     !/^[a-z][a-z0-9-]{2,63}$/.test(job.runId)||
     !/^[a-z][a-z0-9-]{2,63}$/.test(job.leaseId))
    throw new Error("invalid coordinator job envelope");
  const output=runPureTextAdapter(job.kind,job.input);
  const ref:JobReference={missionId:job.missionId,taskId:job.taskId,
    runId:job.runId,leaseId:job.leaseId};
  const done=await post("/executor/v1/complete",{...ref,output});
  if(!done.ok)throw new Error("executor completion rejected: "+done.status);
  const result=await done.json() as {status:string;runId:string};
  if(result.status!=="completed"||result.runId!==job.runId)
    throw new Error("invalid coordinator completion acknowledgement");
  return {status:"completed",missionId:job.missionId,taskId:job.taskId,runId:job.runId};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const url=process.env.EAI_EXECUTOR_URL??"http://127.0.0.1:8788";
  const token=process.env.EAI_EXECUTOR_TOKEN??"";
  try{
    const result=await runExecutorOnce(url,token);
    process.stdout.write(result.status==="idle"?
      "Geen toegestane teksttaak in de wachtrij.\n":
      "Teksttaak "+result.taskId+" afgerond.\n");
  }catch{
    // Do not echo token, text input or server response bodies.
    process.stderr.write("Tekstworker kon de taak niet veilig afronden.\n");
    process.exitCode=1;
  }
}

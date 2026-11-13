/**
 * Official GitHub Actions check for one previously submitted release candidate.
 * A passing run is transport-level evidence of CI metadata, not artifact
 * provenance, reproducibility, test completeness or publication approval.
 */
import type {ReleaseCandidate} from "./missions.ts";
export interface CiObservation {
  source:"github-actions-api";
  runId:number;
  attempt:number;
  commitSha:string;
  observedAt:string;
  result:"success";
}
export type GitHubReader=(url:string,init:RequestInit)=>Promise<Response>;
export async function verifyGitHubActionsRun(
  candidate:ReleaseCandidate,reader:GitHubReader=fetch,
  token?:string,
):Promise<CiObservation>{
  const match=/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/actions\/runs\/([1-9][0-9]*)$/
    .exec(candidate.ciRunUrl);
  if(!match)throw new Error("invalid GitHub Actions run URL");
  const repo=match[1]+"/"+match[2],runId=Number(match[3]);
  if(repo.toLowerCase()!==candidate.repository.toLowerCase()||
     !Number.isSafeInteger(runId)||runId<1)
    throw new Error("GitHub Actions repository or run ID mismatch");
  const headers:Record<string,string>={
    accept:"application/vnd.github+json",
    "user-agent":"eaiwork-local-release-check",
    "x-github-api-version":"2022-11-28",
  };
  if(token)headers.authorization="Bearer "+token;
  const response=await reader("https://api.github.com/repos/"+repo+"/actions/runs/"+runId,{
    method:"GET",headers,redirect:"error",signal:AbortSignal.timeout(8000),
  });
  if(!response.ok)throw new Error("GitHub Actions API returned HTTP "+response.status);
  const advertised=Number(response.headers.get("content-length")||0);
  if(advertised>96000)throw new Error("GitHub Actions response too large");
  const body=response.body?.getReader();
  if(!body)throw new Error("GitHub Actions response has no body");
  const chunks:Uint8Array[]=[];
  let total=0;
  while(true){
    const next=await body.read();
    if(next.done)break;
    total+=next.value.byteLength;
    if(total>96000){
      await body.cancel();
      throw new Error("GitHub Actions response too large");
    }
    chunks.push(next.value);
  }
  let data:unknown;
  try{data=JSON.parse(Buffer.concat(chunks).toString("utf8"))}
  catch{throw new Error("GitHub Actions response is invalid JSON")}
  if(!data||typeof data!=="object"||Array.isArray(data))
    throw new Error("invalid GitHub Actions response");
  const run=data as Record<string,unknown>;
  const repository=(run.repository as {full_name?:unknown}|undefined)?.full_name;
  const attempt=run.run_attempt;
  if(run.id!==runId||
     typeof repository!=="string"||repository.toLowerCase()!==repo.toLowerCase()||
     typeof run.head_sha!=="string"||
     run.head_sha.toLowerCase()!==candidate.commitSha.toLowerCase()||
     run.head_sha.toLowerCase()!==candidate.ciHeadSha.toLowerCase())
    throw new Error("GitHub Actions run does not match release candidate");
  if(run.status!=="completed"||run.conclusion!=="success")
    throw new Error("GitHub Actions run is not completed successfully");
  if(!Number.isSafeInteger(attempt)||Number(attempt)<1)
    throw new Error("GitHub Actions attempt missing");
  return {source:"github-actions-api",runId,attempt:attempt as number,
    commitSha:run.head_sha.toLowerCase(),observedAt:new Date().toISOString(),
    result:"success"};
}

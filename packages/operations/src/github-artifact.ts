/**
 * Check one ZIP member from a run-scoped GitHub Actions artifact.
 * Never writes or executes archive content, follows arbitrary redirects,
 * or sends GitHub credentials to signed artifact storage.
 */
import {createHash} from "node:crypto";
import {inflateRawSync} from "node:zlib";
import type {ReleaseCandidate,ReleaseDossier} from "./missions.ts";
import {verifyGitHubActionsRun,type GitHubReader} from "./github-actions.ts";

const MAX_ZIP=16*1024*1024,MAX_ENTRY=16*1024*1024;
const MAX_TOTAL=24*1024*1024,MAX_ENTRIES=64;
const fail=(msg:string):never=>{throw new Error(msg)};
const sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
const region=(at:number,n:number,limit:number)=>
  Number.isSafeInteger(at)&&Number.isSafeInteger(n)&&at>=0&&n>=0&&at<=limit&&n<=limit-at;
const validPath=(p:string)=>{
  const parts=(p.endsWith("/")?p.slice(0,-1):p).split("/");
  return p.length>0&&p.length<=240&&!p.startsWith("/")&&
    /^[A-Za-z0-9_./-]+$/.test(p)&&parts.every(x=>x!==""&&x!=="."&&x!=="..");
};
export function checkArtifactSelection(
  candidate:ReleaseCandidate,artifactName:unknown,entryPath:unknown,
):void {
  if(typeof artifactName!=="string"||
     !/^[A-Za-z0-9_.-]{1,100}$/.test(artifactName)||
     artifactName==="."||artifactName==="..")
    fail("invalid artifact name");
  if(typeof entryPath!=="string"||!validPath(entryPath)||entryPath.endsWith("/"))
    fail("invalid archive entry path");
  const basename=candidate.artifactPath.split("/").at(-1);
  if(entryPath!==candidate.artifactPath&&entryPath!==basename)
    fail("ZIP path must match the candidate filename");
}
function selectedRun(candidate:ReleaseCandidate){
  const m=/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/actions\/runs\/([1-9][0-9]*)$/
    .exec(candidate.ciRunUrl);
  if(!m||m[1].toLowerCase()+"/"+m[2].toLowerCase()!==candidate.repository.toLowerCase())
    fail("invalid CI repository");
  const runId=Number(m![3]);
  if(!Number.isSafeInteger(runId)||runId<1)fail("invalid run ID");
  return {repo:m![1]+"/"+m![2],runId};
}
async function boundedResponse(response:Response,max:number):Promise<Buffer>{
  if(!response.ok)fail("GitHub returned HTTP "+response.status);
  const len=response.headers.get("content-length");
  if(len!==null&&(!/^[0-9]+$/.test(len)||Number(len)>max))
    fail("GitHub response exceeds limit");
  const stream=response.body?.getReader();
  if(!stream)fail("GitHub response has no body");
  let total=0;const buffers:Buffer[]=[];
  while(true){
    const part=await stream.read();
    if(part.done)break;
    total+=part.value.byteLength;
    if(total>max){
      await stream.cancel();
      fail("GitHub response exceeds limit");
    }
    buffers.push(Buffer.from(part.value));
  }
  return Buffer.concat(buffers,total);
}
const headers=(token?:string)=>{
  const result:Record<string,string>={
    accept:"application/vnd.github+json","user-agent":"eaiwork-artifact-review",
    "x-github-api-version":"2022-11-28",
  };
  if(token)result.authorization="Bearer "+token;
  return result;
};
export function allowedSignedArtifactUrl(location:string):string{
  if(location.length>4096)fail("artifact redirect too long");
  let url:URL;
  try{url=new URL(location)}catch{return fail("invalid artifact redirect")}
  const hostname=url.hostname.toLowerCase();
  const azure=/^productionresultssa[0-9]{1,3}\.blob\.core\.windows\.net$/.test(hostname)&&
    url.pathname.startsWith("/actions-results/");
  const github=["pipelines.actions.githubusercontent.com",
    "objects.githubusercontent.com"].includes(hostname);
  if(url.protocol!=="https:"||url.port||url.username||url.password||url.hash||
     (!azure&&!github))fail("artifact redirect is not from an allowed host");
  return url.href;
}
function crc32(bytes:Uint8Array):number{
  let value=0xffffffff;
  for(const byte of bytes){
    value^=byte;
    for(let bit=0;bit<8;bit++)value=(value>>>1)^(value&1?0xedb88320:0);
  }
  return (value^0xffffffff)>>>0;
}
interface Entry {
  name:string;offset:number;flags:number;method:number;
  compressed:number;uncompressed:number;crc:number;
}
/**
 * Strict ZIP32 central-directory parser. Rejects symlinks, duplicates, paths
 * outside the archive, ZIP64, overlays, overlapping members and zip bombs.
 * Only the requested member is decompressed and hashed, never executed.
 */
export function inspectActionsZip(
  buffer:Buffer,entryPath:string,expectedSha:string,
):{sha256:string;sizeBytes:number;archiveSha256:string;entryPath:string}{
  if(buffer.length<22||buffer.length>MAX_ZIP)fail("ZIP outside size limits");
  let end=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--){
    if(buffer.readUInt32LE(i)===0x06054b50&&
       i+22+buffer.readUInt16LE(i+20)===buffer.length){end=i;break}
  }
  if(end<0)fail("ZIP end record missing");
  if(buffer.readUInt16LE(end+4)!==0||buffer.readUInt16LE(end+6)!==0||
     buffer.readUInt16LE(end+8)!==buffer.readUInt16LE(end+10))
    fail("ZIP multi-disk archive unsupported");
  const count=buffer.readUInt16LE(end+10);
  const dirSize=buffer.readUInt32LE(end+12),dirStart=buffer.readUInt32LE(end+16);
  if(count<1||count>MAX_ENTRIES||!dirSize||!region(dirStart,dirSize,end)||
     dirStart+dirSize!==end)fail("invalid or unsupported ZIP directory");
  const entries:Entry[]=[],seen=new Set<string>();
  let cursor=dirStart,total=0;
  for(let i=0;i<count;i++){
    if(!region(cursor,46,end)||buffer.readUInt32LE(cursor)!==0x02014b50)
      fail("invalid ZIP central header");
    const flags=buffer.readUInt16LE(cursor+8),method=buffer.readUInt16LE(cursor+10);
    const crc=buffer.readUInt32LE(cursor+16);
    const compressed=buffer.readUInt32LE(cursor+20);
    const uncompressed=buffer.readUInt32LE(cursor+24);
    const nameLen=buffer.readUInt16LE(cursor+28);
    const recordLen=46+nameLen+buffer.readUInt16LE(cursor+30)+buffer.readUInt16LE(cursor+32);
    const offset=buffer.readUInt32LE(cursor+42);
    if(!nameLen||!region(cursor,recordLen,dirStart+dirSize)||
       !region(offset,30,dirStart)||buffer.readUInt16LE(cursor+34)!==0||
       flags&~0x808||![0,8].includes(method)||
       compressed===0xffffffff||uncompressed===0xffffffff||
       compressed>MAX_ZIP||uncompressed>MAX_ENTRY)
      fail("unsupported ZIP member");
    const name=buffer.subarray(cursor+46,cursor+46+nameLen).toString("utf8");
    if(!validPath(name)||seen.has(name))fail("unsafe or duplicate ZIP path");
    seen.add(name);
    if(((buffer.readUInt32LE(cursor+38)>>>16)&0xf000)===0xa000)
      fail("ZIP symlinks not allowed");
    if(name.endsWith("/")){
      if(compressed||uncompressed)fail("ZIP directory contains bytes");
    }else{
      if(!compressed||!uncompressed||uncompressed>compressed*128)
        fail("ZIP compression ratio too high");
      total+=uncompressed;
      if(total>MAX_TOTAL)fail("ZIP extracted size exceeds limit");
    }
    entries.push({name,offset,flags,method,compressed,uncompressed,crc});
    cursor+=recordLen;
  }
  if(cursor!==dirStart+dirSize)fail("ZIP directory trailing data");
  const spans:{start:number;end:number}[]=[];
  for(const entry of entries){
    const at=entry.offset;
    if(buffer.readUInt32LE(at)!==0x04034b50||
       buffer.readUInt16LE(at+6)!==entry.flags||
       buffer.readUInt16LE(at+8)!==entry.method)
      fail("ZIP local header mismatch");
    const nameLen=buffer.readUInt16LE(at+26),extraLen=buffer.readUInt16LE(at+28);
    const headerSize=30+nameLen+extraLen;
    if(!region(at,headerSize,dirStart))fail("ZIP local header too large");
    if(buffer.subarray(at+30,at+30+nameLen).toString("utf8")!==entry.name)
      fail("ZIP local filename mismatch");
    const payload=at+headerSize;
    if(!region(payload,entry.compressed,dirStart))
      fail("ZIP payload outside archive");
    if(!(entry.flags&8)&&(buffer.readUInt32LE(at+14)!==entry.crc||
       buffer.readUInt32LE(at+18)!==entry.compressed||
       buffer.readUInt32LE(at+22)!==entry.uncompressed))
      fail("ZIP local sizes differ from central directory");
    spans.push({start:at,end:payload+entry.compressed});
  }
  spans.sort((a,b)=>a.start-b.start);
  for(let i=1;i<spans.length;i++)
    if(spans[i].start<spans[i-1].end)fail("overlapping ZIP members");
  const selected=entries.find(e=>e.name===entryPath&&!e.name.endsWith("/"));
  if(!selected)fail("specified ZIP file not found");
  const offset=selected.offset;
  const start=offset+30+buffer.readUInt16LE(offset+26)+buffer.readUInt16LE(offset+28);
  const source=buffer.subarray(start,start+selected.compressed);
  let contents:Buffer;
  try{
    contents=selected.method===0?Buffer.from(source):
      inflateRawSync(source,{maxOutputLength:selected.uncompressed+1});
  }catch{return fail("ZIP decompression failed")}
  if(contents.length!==selected.uncompressed||crc32(contents)!==selected.crc)
    fail("ZIP member CRC or size mismatch");
  const computed=sha(contents);
  if(computed.toLowerCase()!==expectedSha.toLowerCase())
    fail("downloaded file does not match submitted SHA-256");
  return {sha256:computed,sizeBytes:contents.length,
    archiveSha256:sha(buffer),entryPath};
}
export interface GitHubArtifactObservation {
  source:"github-actions-artifact";
  runId:number;attempt:number;commitSha:string;
  artifactId:number;artifactName:string;entryPath:string;
  archiveSha256:string;sha256:string;sizeBytes:number;observedAt:string;
}
export async function verifyGitHubRunArtifact(
  dossier:ReleaseDossier,artifactName:string,entryPath:string,
  reader:GitHubReader=fetch,token?:string,
):Promise<GitHubArtifactObservation>{
  const candidate=dossier.candidate;
  checkArtifactSelection(candidate,artifactName,entryPath);
  const previous=dossier.ciObservation;
  if(!previous||previous.source!=="github-actions-api"||
     previous.result!=="success")
    fail("GitHub CI verification required first");
  const {repo,runId}=selectedRun(candidate);
  if(previous.runId!==runId||
     previous.commitSha.toLowerCase()!==candidate.commitSha.toLowerCase())
    fail("GitHub CI record does not match candidate");
  // The artifact API does not bind each member to a retry attempt.
  // Limit this version to the initial successful attempt.
  if(previous.attempt!==1)fail("rerun artifact attribution unsupported");
  const current=await verifyGitHubActionsRun(candidate,reader,token);
  if(current.runId!==runId||current.attempt!==1)
    fail("GitHub CI attempt changed since verification");
  const listUrl="https://api.github.com/repos/"+repo+
    "/actions/runs/"+runId+"/artifacts?per_page=100&name="+
    encodeURIComponent(artifactName);
  const listed=await reader(listUrl,{
    method:"GET",headers:headers(token),redirect:"error",
    signal:AbortSignal.timeout(8000),
  });
  let data:unknown;
  try{data=JSON.parse((await boundedResponse(listed,256*1024)).toString("utf8"))}
  catch{return fail("invalid run artifact listing")}
  if(!data||typeof data!=="object"||Array.isArray(data))
    fail("invalid artifact listing");
  const listing=data as Record<string,unknown>;
  if(listing.total_count!==1||!Array.isArray(listing.artifacts)||
     listing.artifacts.length!==1)
    fail("run artifact name is missing or ambiguous");
  const artifact=listing.artifacts[0] as Record<string,unknown>;
  if(!artifact||typeof artifact!=="object"||Array.isArray(artifact)||
     artifact.name!==artifactName||artifact.expired!==false||
     !Number.isSafeInteger(artifact.id)||Number(artifact.id)<1||
     !Number.isSafeInteger(artifact.size_in_bytes)||
     Number(artifact.size_in_bytes)<1||Number(artifact.size_in_bytes)>MAX_ZIP)
    fail("run artifact is invalid, expired or oversized");
  const workflow=artifact.workflow_run;
  if(workflow&&typeof workflow==="object"&&!Array.isArray(workflow)){
    const w=workflow as Record<string,unknown>;
    if(w.id!==runId||typeof w.head_sha!=="string"||
       w.head_sha.toLowerCase()!==candidate.commitSha.toLowerCase())
      fail("artifact belongs to another workflow run");
  }
  const artifactId=artifact.id as number;
  const apiUrl="https://api.github.com/repos/"+repo+
    "/actions/artifacts/"+artifactId+"/zip";
  if(artifact.archive_download_url!==apiUrl)
    fail("artifact download endpoint does not match repository");
  const redirect=await reader(apiUrl,{
    method:"GET",headers:headers(token),redirect:"manual",
    signal:AbortSignal.timeout(8000),
  });
  if(redirect.status!==302)fail("GitHub did not issue the expected ZIP redirect");
  const location=redirect.headers.get("location");
  if(!location)fail("artifact redirect missing");
  const signed=allowedSignedArtifactUrl(location);
  const response=await reader(signed,{
    method:"GET",redirect:"error",headers:{accept:"application/zip"},
    signal:AbortSignal.timeout(15000),
  });
  const zip=await boundedResponse(response,MAX_ZIP);
  const checked=inspectActionsZip(zip,entryPath,candidate.artifactSha256);
  return {source:"github-actions-artifact",runId,attempt:1,
    commitSha:candidate.commitSha.toLowerCase(),artifactId,artifactName,
    entryPath,archiveSha256:checked.archiveSha256,sha256:checked.sha256,
    sizeBytes:checked.sizeBytes,observedAt:new Date().toISOString()};
}

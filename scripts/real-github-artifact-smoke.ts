/**
 * Real GitHub Actions artifact smoke:
 * - 'build' creates a small executable JS bundle from source and tests it.
 * - 'verify' inspects the artifact of a PRIOR completed workflow run through
 *   EAIwork's real HTTP endpoints. Never publishes or deploys anything.
 *
 * A run cannot verify its own artifact, because it is still in_progress.
 * The first run uploads the fixture; the following push verifies the prior run.
 */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "./local-demo.ts";

const expectedRepo="E-AI-MODEL/EAIwork-";
const expectedBranch="feature/artifact-real-run-smoke-v01-20261110";
const workflow="artifact-real-proof.yml";
const artifactName="eaiwork-real-proof";
const candidatePath="dist/eaiwork-proof.mjs";
const archiveEntry="eaiwork-proof.mjs";
const sha=(value:Uint8Array)=>createHash("sha256").update(value).digest("hex");

function candidateBytes():Buffer{
  const source=readFileSync(new URL("../examples/artifact-proof/source.mjs",import.meta.url),"utf8");
  return Buffer.from("// Generated EAIwork proof module v1. Do not publish automatically.\n"+
    source.trimEnd()+"\n","utf8");
}
async function build():Promise<Buffer>{
  const bytes=candidateBytes();
  mkdirSync("dist",{recursive:true});
  writeFileSync(candidatePath,bytes);
  const generated=await import(pathToFileURL(resolve(candidatePath)).href+"?local-artifact-proof");
  assert.equal(generated.normalizeWords("  Een   twee\n drie  "),"Een twee drie");
  assert.equal(generated.wordCount("  Een   twee\n drie  "),3);
  assert.equal(generated.wordCount(" "),0);
  assert.deepEqual(readFileSync(candidatePath),bytes);
  process.stdout.write("Kandidaat gebouwd en getest: "+bytes.byteLength+" bytes, SHA-256 "+sha(bytes)+"\n");
  return bytes;
}
async function verify():Promise<void>{
  const repository=process.env.GITHUB_REPOSITORY;
  const token=process.env.GITHUB_TOKEN;
  const current=Number(process.env.GITHUB_RUN_ID);
  if(repository!==expectedRepo||process.env.GITHUB_REF_NAME!==expectedBranch||
     !token||!Number.isSafeInteger(current)||current<1)
    throw new Error("Deze proef mag alleen draaien in de ingestelde GitHub Actions-branch");
  const apiBase="https://api.github.com/repos/"+expectedRepo;
  const apiHeaders={
    authorization:"Bearer "+token,
    accept:"application/vnd.github+json",
    "user-agent":"eaiwork-artifact-real-smoke",
    "x-github-api-version":"2022-11-28",
  };
  const runsUrl=apiBase+"/actions/workflows/"+workflow+"/runs?"+
    "branch="+encodeURIComponent(expectedBranch)+"&per_page=30";
  const response=await fetch(runsUrl,{
    method:"GET",headers:apiHeaders,redirect:"error",signal:AbortSignal.timeout(10000),
  });
  if(!response.ok)throw new Error("GitHub-workflowlijst niet beschikbaar: HTTP "+response.status);
  const listing=await response.json() as {workflow_runs?:Array<{
    id:number;head_sha:string;head_branch?:string;status:string;
    conclusion:string;run_attempt:number;event:string;
  }>};
  const previous=(listing.workflow_runs??[]).find(run=>
    run.id!==current&&run.head_branch===expectedBranch&&run.event==="push"&&
    run.status==="completed"&&run.conclusion==="success"&&run.run_attempt===1&&
    /^[a-f0-9]{40}$/i.test(run.head_sha));
  if(!previous){
    if(process.env.EAI_REQUIRE_PREVIOUS==="1")
      throw new Error("Nog geen voltooide voorafgaande workflowrun met artifact gevonden");
    process.stdout.write("EERSTE RUN: artifact geproduceerd; controle volgt in de volgende workflowrun.\n");
    return;
  }
  const expected=candidateBytes(),expectedSha=sha(expected);
  const runId=previous.id;
  const missionId="mission-real-artifact-"+runId;
  const demo=createDemoServer({schedulerIntervalMs:0,githubReadToken:token});
  try{
    await new Promise<void>(resolveListen=>
      demo.server.listen(0,"127.0.0.1",resolveListen));
    const base="http://127.0.0.1:"+(demo.server.address() as AddressInfo).port;
    const headers={authorization:"Bearer "+demo.token,"content-type":"application/json"};
    const post=async(path:string,body:unknown,expectedStatus:number)=>{
      const reply=await fetch(base+path,{method:"POST",headers,
        body:JSON.stringify(body),redirect:"error",signal:AbortSignal.timeout(60000)});
      const responseBody=await reply.text();
      assert.equal(reply.status,expectedStatus,
        "Unexpected HTTP status for "+path+" ("+reply.status+") "+responseBody.slice(0,450));
      return responseBody?JSON.parse(responseBody):null;
    };
    const get=async(path:string)=>{
      const reply=await fetch(base+path,{headers:{authorization:"Bearer "+demo.token},
        signal:AbortSignal.timeout(10000)});
      assert.equal(reply.status,200);
      return reply.json();
    };
    const mission={
      id:missionId,title:"Echte GitHub-artifactcontrole",
      goal:"Verifieer de bytes van een artifact uit een afgeronde GitHub-run",
      tasks:[{id:"task-clean",title:"Bewerk proeftekst",taskKind:"text-normalize",
        dependsOn:[],input:{text:"  Werkende   proef "}}],
    };
    const candidate={
      repository:expectedRepo,commitSha:previous.head_sha,
      ciHeadSha:previous.head_sha,artifactPath:candidatePath,
      artifactSha256:expectedSha,
      ciRunUrl:"https://github.com/"+expectedRepo+"/actions/runs/"+runId,
      licenseRef:"LICENSE",checkNames:["build","tests","upload"],
    };
    await post("/ops/missions",{plan:mission},201);
    await post("/ops/missions/"+missionId+"/step",{},200);
    await post("/ops/missions/"+missionId+"/release/submit",
      {expectedRevision:1,candidate},201);
    await post("/ops/missions/"+missionId+"/release/verify-ci",{},200);
    const result=await post("/ops/missions/"+missionId+"/release/verify-github-artifact",
      {artifactName,entryPath:archiveEntry},200);
    assert.equal(result.observation.runId,runId);
    assert.equal(result.observation.commitSha,previous.head_sha.toLowerCase());
    assert.equal(result.observation.sha256,expectedSha);
    assert.equal(result.observation.entryPath,archiveEntry);
    assert.equal(result.observation.source,"github-actions-artifact");
    assert.equal(result.publicationAllowed,false);
    assert.equal(result.buildReproducibilityVerified,false);
    const overview=await get("/ops/production-line");
    const record=(overview as any).missions.find((m:any)=>m.id===missionId);
    assert.equal(record?.releaseDossier?.githubArtifactVerification,"run-artifact-matched");
    assert.equal(record?.releaseDossier?.artifactOriginVerified,true);
    assert.equal(record?.publication?.allowed,false);
    assert.equal((overview as any).releaseGate,"not-implemented");
    const integrity=await get("/ops/verify");
    assert.equal((integrity as any).ok,true);
    process.stdout.write("ECHTE PROEF GESLAAGD: run "+runId+
      ", artifact "+result.observation.artifactId+
      ", commit "+previous.head_sha+", SHA-256 "+expectedSha+
      ", publicatie geblokkeerd.\n");
  }finally{await demo.close()}
}
const mode=process.argv[2];
if(mode==="build")await build();
else if(mode==="verify")await verify();
else throw new Error("Gebruik: node scripts/real-github-artifact-smoke.ts build|verify");

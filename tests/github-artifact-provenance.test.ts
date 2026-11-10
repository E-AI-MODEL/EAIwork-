import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {deflateRawSync} from "node:zlib";
import {readFileSync} from "node:fs";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "../scripts/local-demo.ts";
import {inspectActionsZip,allowedSignedArtifactUrl,
  verifyGitHubRunArtifact,type GitHubArtifactObservation} from "../packages/operations/src/github-artifact.ts";
import type {GitHubReader} from "../packages/operations/src/github-actions.ts";
import type {ReleaseDossier} from "../packages/operations/src/missions.ts";

const sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
const runId=42700000000,commit="a".repeat(40),artifactId=123;
const bytes=Buffer.from("GitHub Actions bestand voor deze test.\n","utf8");
const name="candidate.bin",fullPath="dist/candidate.bin",artifactName="release-test";
const signed="https://productionresultssa18.blob.core.windows.net/actions-results/abcd/artifacts/123.zip?sig=fake";
const base="https://api.github.com/repos/E-AI-MODEL/EAIwork-";
const ciUrl="https://github.com/E-AI-MODEL/EAIwork-/actions/runs/"+runId;
const downloadUrl=base+"/actions/artifacts/"+artifactId+"/zip";
function crc32(data:Buffer){
  let crc=0xffffffff;
  for(const byte of data){crc^=byte;for(let j=0;j<8;j++)
    crc=(crc>>>1)^(crc&1?0xedb88320:0)}
  return (crc^0xffffffff)>>>0;
}
function zip(entries:Array<{name:string;bytes:Buffer;deflate?:boolean;symlink?:boolean}>):Buffer{
  let cursor=0;
  const locals:Buffer[]=[],central:Buffer[]=[];
  for(const entry of entries){
    const member=Buffer.from(entry.name,"utf8");
    const payload=entry.deflate?deflateRawSync(entry.bytes):entry.bytes;
    const flags=0x800,method=entry.deflate?8:0,crc=crc32(entry.bytes);
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);
    local.writeUInt16LE(20,4);local.writeUInt16LE(flags,6);
    local.writeUInt16LE(method,8);local.writeUInt32LE(crc,14);
    local.writeUInt32LE(payload.length,18);
    local.writeUInt32LE(entry.bytes.length,22);
    local.writeUInt16LE(member.length,26);
    locals.push(local,member,payload);
    const record=Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50,0);
    record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);
    record.writeUInt16LE(flags,8);record.writeUInt16LE(method,10);
    record.writeUInt32LE(crc,16);record.writeUInt32LE(payload.length,20);
    record.writeUInt32LE(entry.bytes.length,24);
    record.writeUInt16LE(member.length,28);
    record.writeUInt32LE(entry.symlink?0xa0000000:0,38);
    record.writeUInt32LE(cursor,42);
    central.push(record,member);
    cursor+=local.length+member.length+payload.length;
  }
  const directory=Buffer.concat(central);
  const end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);
  end.writeUInt16LE(entries.length,8);
  end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(directory.length,12);
  end.writeUInt32LE(cursor,16);
  return Buffer.concat([...locals,directory,end]);
}
const goodZip=()=>zip([{name:fullPath,bytes,deflate:true}]);
const goodRun=()=>({id:runId,repository:{full_name:"E-AI-MODEL/EAIwork-"},
  head_sha:commit,status:"completed",conclusion:"success",run_attempt:1});
const candidate=()=>({
  repository:"E-AI-MODEL/EAIwork-",commitSha:commit,ciHeadSha:commit,
  ciRunUrl:ciUrl,artifactPath:fullPath,artifactSha256:sha(bytes),
  licenseRef:"LICENSE",checkNames:["unit"],
});
const dossier=():ReleaseDossier=>({
  revision:1,candidate:candidate(),submittedAt:"2026-11-10T08:00:00Z",
  submittedBy:"person:demo",ciObservation:{source:"github-actions-api",runId,
    attempt:1,commitSha:commit,observedAt:"2026-11-10T08:00:01Z",result:"success"},
});
function artifactReader(options:{
  zipBytes?:Buffer;redirect?:string;run?:unknown;items?:unknown[];
  status?:number;archiveHeaderLength?:number;
}={}):GitHubReader{
  const stored=options.zipBytes??goodZip();
  return async(url,init)=>{
    if(url===base+"/actions/runs/"+runId){
      assert.equal(init.redirect,"error");
      return Response.json(options.run??goodRun());
    }
    if(url===base+"/actions/runs/"+runId+"/artifacts?per_page=100&name="+artifactName){
      const items=options.items??[{
        id:artifactId,name:artifactName,expired:false,size_in_bytes:stored.length,
        archive_download_url:downloadUrl,
        workflow_run:{id:runId,head_sha:commit},
      }];
      return Response.json({total_count:items.length,artifacts:items});
    }
    if(url===downloadUrl){
      assert.equal(init.redirect,"manual");
      return new Response(null,{status:302,
        headers:{location:options.redirect??signed}});
    }
    if(url===signed){
      assert.equal(init.redirect,"error");
      assert.equal((init.headers as Record<string,string>).authorization,undefined,
        "GitHub API bearer token must not reach the signed artifact URL");
      return new Response(stored,{status:options.status??200,
        headers:options.archiveHeaderLength?{"content-length":String(options.archiveHeaderLength)}:{}});
    }
    throw new Error("unexpected GitHub host or path: "+url);
  };
}
test("ZIP parser hashes exactly one selected file with deflate or stored compression",()=>{
  const deflated=inspectActionsZip(goodZip(),fullPath,sha(bytes));
  assert.equal(deflated.sha256,sha(bytes));
  assert.equal(deflated.sizeBytes,bytes.length);
  assert.equal(deflated.archiveSha256,sha(goodZip()));
  const stored=zip([{name,bytes}]);
  assert.equal(inspectActionsZip(stored,name,sha(bytes)).sizeBytes,bytes.length);
  assert.throws(()=>inspectActionsZip(stored,"other.bin",sha(bytes)),/not found/);
  assert.throws(()=>inspectActionsZip(stored,name,"b".repeat(64)),/SHA-256/);
});
test("ZIP parser rejects path escape, duplicate, symlinks, zip bombs and corruption",()=>{
  const invalid=[
    zip([{name:"../evil.txt",bytes}]),
    zip([{name:"/absolute.bin",bytes}]),
    zip([{name:"dir\\outside.bin",bytes}]),
    zip([{name,bytes},{name,bytes}]),
    zip([{name,bytes,symlink:true}]),
    zip([{name,bytes:Buffer.alloc(256000,65),deflate:true}]),
  ];
  for(const archive of invalid)
    assert.throws(()=>inspectActionsZip(archive,name,sha(bytes)));
  const broken=Buffer.from(zip([{name,bytes}]));
  broken[30+Buffer.byteLength(name)+2]^=0x8;
  assert.throws(()=>inspectActionsZip(broken,name,sha(bytes)),/CRC/);
  assert.throws(()=>inspectActionsZip(Buffer.from("not a ZIP"),name,sha(bytes)));
});
test("signed storage host is checked before HTTP and never allows arbitrary redirects",()=>{
  assert.equal(allowedSignedArtifactUrl(signed),signed);
  for(const location of [
    "http://productionresultssa18.blob.core.windows.net/actions-results/x.zip",
    "https://api.github.com/evil",
    "https://localhost/secret",
    "https://example.invalid/artifact.zip",
    "https://productionresultssa18.blob.core.windows.net.evil.com/actions-results/x",
    "https://productionresultssa18.blob.core.windows.net:8443/actions-results/x",
    "https://me:pass@productionresultssa18.blob.core.windows.net/actions-results/x",
    "https://productionresultssa18.blob.core.windows.net/private/x",
  ])assert.throws(()=>allowedSignedArtifactUrl(location));
});
test("run artifact reader verifies run, listing, redirect and content without forwarding token",async()=>{
  const result=await verifyGitHubRunArtifact(dossier(),artifactName,fullPath,
    artifactReader(),"private-read-token");
  assert.equal(result.source,"github-actions-artifact");
  assert.equal(result.runId,runId);
  assert.equal(result.attempt,1);
  assert.equal(result.sha256,sha(bytes));
  assert.equal(result.artifactId,artifactId);
  assert.equal(result.entryPath,fullPath);
  assert.equal(result.sizeBytes,bytes.length);
  for(const changes of [
    {redirect:"https://localhost/secret"},
    {run:{...goodRun(),conclusion:"failure"}},
    {run:{...goodRun(),run_attempt:2}},
    {items:[]},
    {items:[{name:artifactName,id:artifactId,expired:true,
      size_in_bytes:100,archive_download_url:downloadUrl}]},
    {items:[{name:artifactName,id:artifactId,expired:false,
      size_in_bytes:100,archive_download_url:"https://evil.invalid/zip"}]},
    {items:[{name:artifactName,id:artifactId,expired:false,
      size_in_bytes:100,archive_download_url:downloadUrl,
      workflow_run:{id:123,head_sha:commit}}]},
    {zipBytes:zip([{name:fullPath,bytes:Buffer.from("changed")}])},
    {archiveHeaderLength:16*1024*1024+1},
  ])await assert.rejects(
    verifyGitHubRunArtifact(dossier(),artifactName,fullPath,artifactReader(changes)));
  await assert.rejects(verifyGitHubRunArtifact(dossier(),"../other",fullPath,artifactReader()));
  await assert.rejects(verifyGitHubRunArtifact(dossier(),artifactName,"../other",artifactReader()));
  await assert.rejects(verifyGitHubRunArtifact({
    ...dossier(),ciObservation:{...dossier().ciObservation!,attempt:2},
  },artifactName,fullPath,artifactReader()),/rerun/);
});
test("server records one GitHub artifact origin after verified CI and keeps publication blocked",async()=>{
  const demo=createDemoServer({schedulerIntervalMs:0,githubActionReader:artifactReader()});
  try{
    await new Promise<void>(done=>demo.server.listen(0,"127.0.0.1",done));
    const url="http://127.0.0.1:"+(demo.server.address() as AddressInfo).port;
    const post=(path:string,body:unknown,token=demo.token)=>fetch(url+path,{
      method:"POST",headers:{authorization:"Bearer "+token,
        "content-type":"application/json"},body:JSON.stringify(body),
    });
    const get=(path:string)=>fetch(url+path,{
      headers:{authorization:"Bearer "+demo.token},
    });
    const id="mission-github-artifact";
    const plan={id,title:"Build uit workflowrun",goal:"Controleer het artifactbestand",
      tasks:[{id:"task-clean",title:"Tekst",taskKind:"text-normalize",
        dependsOn:[],input:{text:"  Goedgekeurd  "}}]};
    assert.equal((await post("/ops/missions",{plan})).status,201);
    assert.equal((await post("/ops/missions/"+id+"/step",{})).status,200);
    assert.equal((await post("/ops/missions/"+id+"/release/submit",
      {expectedRevision:1,candidate:candidate()})).status,201);
    const path="/ops/missions/"+id+"/release/verify-github-artifact";
    assert.equal((await post(path,{artifactName,entryPath:fullPath})).status,409,
      "CI must be observed first");
    assert.equal((await post("/ops/missions/"+id+"/release/verify-ci",{})).status,200);
    assert.equal((await post(path,{artifactName,entryPath:fullPath},demo.workerToken)).status,403);
    assert.equal((await post(path,{artifactName,entryPath:fullPath,arbitrary:true})).status,422);
    assert.equal((await post(path,{artifactName,entryPath:"../evil"})).status,422);
    const checked=await post(path,{artifactName,entryPath:fullPath});
    assert.equal(checked.status,200);
    const result=await checked.json() as any;
    assert.equal(result.observation.archiveSha256,sha(goodZip()));
    assert.equal(result.observation.sha256,sha(bytes));
    assert.equal(result.publicationAllowed,false);
    assert.equal(result.buildReproducibilityVerified,false);
    assert.equal((await post(path,{artifactName,entryPath:fullPath})).status,409);
    assert.equal((await post("/ops/events",{
      type:"mission.release.github-artifact.observe",missionId:id,
      expectedRevision:1,observation:result.observation,
    })).status,403);
    const production=await(await get("/ops/production-line")).json() as any;
    const mission=production.missions.find((m:any)=>m.id===id);
    assert.equal(mission.releaseDossier.githubArtifactVerification,"run-artifact-matched");
    assert.equal(mission.releaseDossier.artifactOriginVerified,true);
    assert.equal(mission.releaseDossier.githubArtifactId,artifactId);
    assert.equal(mission.releaseDossier.byteVerification,"unverified");
    assert.equal(mission.publication.allowed,false);
    assert.equal(production.releaseGate,"not-implemented");
    const saved=await(await get("/ops/missions")).json() as any;
    assert.equal(saved.missions[id].releaseDossier.githubArtifactObservation.runId,runId);
    assert.equal(saved.missions[id].releaseDossier.githubArtifactObservation.entryPath,fullPath);
    assert.equal((await get("/ops/verify")).status,200);
  }finally{await demo.close()}
});
test("dashboard contains run artifact form, server route and still no publish action",()=>{
  const html=readFileSync(new URL("../prototypes/dashboard/index.html",import.meta.url),"utf8");
  assert.match(html,/gh-artifact-name-/);
  assert.match(html,/gh-artifact-entry-/);
  assert.match(html,/function checkReleaseGitHubArtifact\(/);
  assert.match(html,/verify-github-artifact/);
  assert.match(html,/case 'release-check-github-artifact'/);
  assert.doesNotMatch(html,/release\/publish/);
});

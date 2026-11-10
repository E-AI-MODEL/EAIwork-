import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import type {AddressInfo} from "node:net";
import {measureArtifactBytes,ArtifactInputError} from "../packages/operations/src/artifact-bytes.ts";
import {createDemoServer} from "../scripts/local-demo.ts";
import {applyOps,emptyOps} from "../packages/operations/src/registry.ts";

const sha=(data:Uint8Array)=>createHash("sha256").update(data).digest("hex");
const good=Buffer.from("EAIwork candidate bytes v1\nUTF8: \xc3\xa9\n");
const candidate=()=>({
  repository:"E-AI-MODEL/EAIwork-",commitSha:"a".repeat(40),
  ciHeadSha:"a".repeat(40),ciRunUrl:"https://github.com/E-AI-MODEL/EAIwork-/actions/runs/42700000000",
  artifactPath:"dist/candidate.bin",artifactSha256:sha(good),
  licenseRef:"LICENSE",checkNames:["unit","integration"],
});
const plan=(id:string)=>({
  id,title:"Opleverdossier met echte bytes",goal:"Bestandsinhoud berekenen zonder uitvoeren",
  tasks:[{id:"task-one",title:"Normaliseer",taskKind:"text-normalize",
    dependsOn:[],input:{text:"  Klaar  "}}],
});
test("streamed digest is exact, bounded and refuses an empty upload",async()=>{
  const stream=async function*(){yield good.subarray(0,7);yield good.subarray(7)};
  const observed=await measureArtifactBytes(stream(),1024);
  assert.equal(observed.sha256,sha(good));
  assert.equal(observed.sizeBytes,good.byteLength);
  await assert.rejects(measureArtifactBytes((async function*(){yield Buffer.alloc(0)})(),512),
    (e:unknown)=>e instanceof ArtifactInputError&&e.code==="empty");
  await assert.rejects(measureArtifactBytes((async function*(){yield Buffer.alloc(400);yield Buffer.alloc(400)})(),512),
    (e:unknown)=>e instanceof ArtifactInputError&&e.code==="too-large");
  await assert.rejects(measureArtifactBytes(stream(),0),/invalid artifact byte limit/);
});
test("the local server hashes actual bytes and only stores a matching, version-bound observation",async()=>{
  const demo=createDemoServer({schedulerIntervalMs:0,maxArtifactBytes:1024});
  try{
    await new Promise<void>(resolve=>demo.server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+(demo.server.address() as AddressInfo).port;
    const postJson=(path:string,body:unknown,token=demo.token)=>fetch(base+path,{
      method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},
      body:JSON.stringify(body),
    });
    const upload=(body:Uint8Array,opts:{
      token?:string;revision?:number;name?:string;type?:string
    }={})=>fetch(base+"/ops/missions/mission-bytes-match/release/verify-bytes",{
      method:"POST",
      headers:{
        authorization:"Bearer "+(opts.token??demo.token),
        "content-type":opts.type??"application/octet-stream",
        "x-eai-artifact-name":opts.name??"candidate.bin",
        "x-eai-mission-revision":String(opts.revision??1),
      },
      body:Buffer.from(body),
    });
    const id="mission-bytes-match";
    assert.equal((await postJson("/ops/missions",{plan:plan(id)})).status,201);
    assert.equal((await postJson("/ops/missions/"+id+"/step",{})).status,200);
    assert.equal((await postJson("/ops/missions/"+id+"/release/submit",
      {candidate:candidate(),expectedRevision:1})).status,201);
    assert.equal((await upload(good,{revision:2})).status,409);
    assert.equal((await upload(good,{name:"different.bin"})).status,422);
    assert.equal((await upload(good,{type:"text/plain"})).status,422);
    assert.equal((await upload(good,{token:demo.workerToken})).status,403);
    assert.equal((await upload(Buffer.alloc(1025))).status,413);
    assert.equal((await upload(Buffer.alloc(0))).status,413);
    assert.equal((await upload(Buffer.from("Wrong bytes"))).status,422);
    const mid=await(await fetch(base+"/ops/production-line",{
      headers:{authorization:"Bearer "+demo.token},
    })).json() as any;
    const before=mid.missions.find((x:any)=>x.id===id);
    assert.equal(before.releaseDossier.byteVerification,"unverified");
    const response=await upload(good);
    assert.equal(response.status,200);
    const result=await response.json() as any;
    assert.equal(result.observation.sha256,sha(good));
    assert.equal(result.observation.sizeBytes,good.length);
    assert.equal(result.observation.source,"local-file-upload");
    assert.equal(result.originVerified,false);
    assert.equal(result.publicationAllowed,false);
    assert.equal((await upload(good)).status,409);
    assert.equal((await postJson("/ops/events",{type:"mission.release.artifact.observe",
      missionId:id,expectedRevision:1,observation:result.observation})).status,403);
    const line=await(await fetch(base+"/ops/production-line",{
      headers:{authorization:"Bearer "+demo.token},
    })).json() as any;
    const item=line.missions.find((x:any)=>x.id===id);
    assert.equal(item.releaseDossier.byteVerification,"local-bytes-matched");
    assert.equal(item.releaseDossier.byteSize,good.length);
    assert.equal(item.releaseDossier.artifactOriginVerified,false);
    assert.equal(item.publication.allowed,false);
    assert.equal(line.releaseGate,"not-implemented");
    assert.equal(JSON.stringify(line).includes(good.toString("utf8")),false);
    const mission=(await(await fetch(base+"/ops/missions",{
      headers:{authorization:"Bearer "+demo.token},
    })).json() as any).missions[id];
    assert.equal(mission.releaseDossier.artifactObservation.checkedBy,"person:demo");
    assert.equal(mission.releaseDossier.artifactObservation.sha256,sha(good));
    assert.equal((await fetch(base+"/ops/verify",{
      headers:{authorization:"Bearer "+demo.token},
    })).status,200);
  }finally{await demo.close()}
});
test("a forged artifact event cannot be recorded by a person even with matching bytes",()=>{
  const state=emptyOps();
  const event={type:"mission.release.artifact.observe" as const,
    missionId:"mission-unknown",expectedRevision:1,
    observation:{source:"local-file-upload" as const,sha256:"a".repeat(64),
      sizeBytes:10,artifactPath:"dist/candidate.bin",
      checkedAt:"2026-11-10T13:00:00Z",checkedBy:"person:owner"}};
  assert.throws(()=>applyOps(state,{
    id:"forged-artifact-event",at:"2026-11-10T13:00:00Z",
    actor:{kind:"person",id:"person:owner"},event,
  }),/unknown mission/);
});
test("dashboard has explicit file picker and never calls release publishing",()=>{
  const html=readFileSync(new URL("../prototypes/dashboard/index.html",import.meta.url),"utf8");
  assert.match(html,/type="file" id="artifact-file-/);
  assert.match(html,/function checkReleaseBytes\(/);
  assert.match(html,/verify-bytes/);
  assert.match(html,/release-check-bytes/);
  assert.match(html,/body:file/);
  assert.match(html,/Herkomst uit GitHub Actions is niet bewezen/);
  assert.doesNotMatch(html,/release\/publish/);
});

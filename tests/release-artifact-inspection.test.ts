import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "../scripts/local-demo.ts";

const sha=(x:Buffer)=>createHash("sha256").update(x).digest("hex");
test("server hashes actual bytes; wrong digest is logged, matching bytes are verified once",async()=>{
  const demo=createDemoServer({schedulerIntervalMs:0});
  try{
    await new Promise<void>(ok=>demo.server.listen(0,"127.0.0.1",ok));
    const base="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
    const call=(method:string,path:string,body?:unknown,token=demo.token)=>fetch(base+path,{
      method,headers:{authorization:"Bearer "+token,
        ...(body?{"content-type":"application/json"}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),
    });
    const bytes=Buffer.from("EAIwork artefact voor SHA-256 test\n");
    const missionId="mission-demo-text";
    const cand={
      id:"release-artifact-test",revision:1,repository:"E-AI-MODEL/EAIwork-",
      commitSha:"e".repeat(40),artifactName:"resultaat.zip",
      artifactSha256:sha(bytes),checkCommitSha:"e".repeat(40),
      checkRunUrl:"https://github.com/E-AI-MODEL/EAIwork-/actions/runs/42802394496",
    };
    assert.equal((await call("POST","/ops/missions/"+missionId+"/releases/candidates",cand)).status,201);
    const path="/ops/missions/"+missionId+"/releases/"+cand.id+"/verify-artifact";
    const upload=(value:Buffer,token=demo.token,mime="application/octet-stream")=>
      fetch(base+path,{method:"POST",headers:{
        authorization:"Bearer "+token,"content-type":mime,
      },body:value});
    assert.equal((await upload(bytes,"wrong")).status,401);
    assert.equal((await upload(bytes,demo.workerToken)).status,403);
    assert.equal((await upload(bytes,demo.token,"text/plain")).status,415);
    assert.equal((await upload(Buffer.alloc(0))).status,422);
    assert.equal((await upload(Buffer.alloc(4*1024*1024+1))).status,413);
    const wrong=await upload(Buffer.from("onjuist bestand"));
    assert.equal(wrong.status,422);
    const mismatch=await wrong.json() as any;
    assert.equal(mismatch.matched,false);
    assert.equal(mismatch.publicationAllowed,false);
    const good=await upload(bytes);
    assert.equal(good.status,200);
    const checked=await good.json() as any;
    assert.equal(checked.matched,true);
    assert.equal(checked.observedSha256,sha(bytes));
    assert.equal(checked.bytes,bytes.byteLength);
    assert.equal(checked.publicationAllowed,false);
    assert.equal((await upload(bytes)).status,422);
    assert.equal((await call("POST","/ops/events",{
      type:"mission.release.artifact.verify",missionId,candidateId:cand.id,
      observedSha256:sha(bytes),bytes:bytes.length,
    })).status,403);
    const list=await(await call("GET","/ops/missions/"+missionId+"/releases")).json() as any;
    const recorded=list.candidates.find((x:any)=>x.id===cand.id);
    assert.equal(recorded.artifactChecks.length,2);
    assert.equal(recorded.artifactChecks[0].matched,false);
    assert.equal(recorded.artifactChecks[1].matched,true);
    assert.equal(list.publicationAllowed,false);
    const line=await(await call("GET","/ops/production-line")).json() as any;
    const m=line.missions.find((x:any)=>x.id===missionId);
    assert.equal(m.releaseCandidate.artifactHashVerified,true);
    assert.equal(m.releaseCandidate.artifactInspections,2);
    assert.equal(m.publication.allowed,false);
    assert.equal((await call("GET","/ops/verify")).status,200);
  }finally{await demo.close()}
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { makeServer } from "../packages/server/src/server.ts";
import { SignedFileAnchorWitness } from "../packages/server/src/witness.ts";

test("operations API is isolated, authenticated and enforces repair decisions", async () => {
  const root=mkdtempSync(join(tmpdir(),"eaiops-http-"));
  const witnessDir=mkdtempSync(join(tmpdir(),"eaiops-witness-"));
  const pair=generateKeyPairSync("ed25519");
  const witness=new SignedFileAnchorWitness(witnessDir,
    pair.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    pair.publicKey.export({format:"pem",type:"spki"}).toString());
  const tokens={
    ["a".repeat(40)]:{actor:{kind:"person" as const,id:"owner"},access:{read:"*" as const,write:[] as string[],audit:true}},
    ["s".repeat(40)]:{actor:{kind:"system" as const,id:"trusted-test-runner"},access:{read:"*" as const,write:[] as string[],audit:true}},
    ["r".repeat(40)]:{actor:{kind:"person" as const,id:"viewer"},access:{read:"*" as const,write:[] as string[]}},
  };
  const pack=JSON.parse(readFileSync(new URL("../packs/sow-demo/pack.json",import.meta.url),"utf8"));
  const {server}=makeServer({dir:join(root,"evidence"),operationsDir:join(root,"ops"),pack,tokens,witness});
  try{
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+((server.address() as AddressInfo).port);
    const request=(method:string,path:string,token?:string,event?:unknown)=>fetch(base+path,{
      method,headers:{...(token?{Authorization:"Bearer "+token}:{}),...(event?{"Content-Type":"application/json"}:{})},
      ...(event?{body:JSON.stringify(event)}:{}),
    });
    const preview=await request("GET","/dashboard");
    assert.equal(preview.status,200);
    assert.match(await preview.text(),/Contracten en registratie/);
    assert.equal((await request("GET","/ops/state")).status,401);
    assert.equal((await request("GET","/ops/state","r".repeat(40))).status,403);
    assert.equal((await request("POST","/ops/events","r".repeat(40),{type:"worker.register"})).status,403);
    const contract={
      id:"proof-worker",version:"1.0.0",name:"Proof worker",specialization:"Verify test fixtures",
      taskKinds:["test"],inputSchema:{type:"object"},outputSchema:{type:"object"},
      tools:[],requestedPermissions:[],modelPolicy:{preferred:"deterministic"},
      testSuite:"fixture-v1",stopConditions:["test-failed"],
    };
    const person="a".repeat(40),system="s".repeat(40);
    assert.equal((await request("POST","/ops/events",person,{type:"worker.register",contract})).status,201);
    assert.equal((await request("POST","/ops/events",person,{type:"worker.release",id:"proof-worker",evidenceRef:"test:1"})).status,422);
    const measurement={id:"test-1",workerId:"proof-worker",version:"1.0.0",
      taskKind:"test",dataset:"frozen-v1",suiteVersion:"fixture-v1",cohort:"holdout",
      metric:"pass-rate",numerator:10,denominator:10,measuredAt:"2026-11-10T00:00:00Z",evidenceRef:"test:1"};
    assert.equal((await request("POST","/ops/events",person,{type:"quality.record",measurement})).status,422);
    assert.equal((await request("POST","/ops/events",system,{type:"quality.record",measurement})).status,201);
    assert.equal((await request("POST","/ops/events",person,{type:"worker.release",id:"proof-worker",evidenceRef:"test:1"})).status,201);
    assert.equal((await request("POST","/ops/events",system,{type:"defect.open",id:"d-1",workerId:"proof-worker",reason:"citation check failed",severity:"quality"})).status,201);
    for(let n=1;n<=3;n++){
      const a={candidateVersion:"1.0."+n,diagnosis:"citation mismatch",changeRef:"change-"+n,suiteVersion:"fixture-v1",resultRef:"test:"+n,passed:false,at:"2026-11-10T00:00:00Z"};
      assert.equal((await request("POST","/ops/events",system,{type:"repair.record",defectId:"d-1",attempt:a})).status,201);
    }
    const state=await(await request("GET","/ops/state",person)).json() as any;
    assert.equal(state.workers["proof-worker"].stage,"quarantined");
    assert.equal(state.defects["d-1"].state,"human-required");
    assert.equal(state.defects["d-1"].attempts.length,3);
    assert.equal((await request("POST","/ops/events",system,{type:"human.decide",defectId:"d-1",choice:"disable",rationale:"stop"})).status,422);
    assert.equal((await request("POST","/ops/events",person,{type:"human.decide",defectId:"d-1",choice:"disable",rationale:"three failed repairs"})).status,201);
    const verified=await(await request("GET","/ops/verify",person)).json() as any;
    assert.equal(verified.ok,true);
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    rmSync(root,{recursive:true,force:true});rmSync(witnessDir,{recursive:true,force:true});
  }
});

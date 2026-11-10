import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {openLocalProfile} from "../scripts/local-profile.ts";
import {LocalCodeWorkspace} from "../packages/operations/src/code-worker.ts";
import type {DockerTestResult,DockerTestInput} from "../packages/operations/src/docker-code-test.ts";
import {runIsolatedNodeTest} from "../packages/operations/src/docker-code-test.ts";
import {createDemoServer} from "../scripts/local-demo.ts";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const newWorkspace=()=>{
  const root=mkdtempSync(join(tmpdir(),"eai-docker-workflow-"));
  const work=join(root,"project"),profile=join(root,"profile");
  mkdirSync(join(work,"src"),{recursive:true});
  mkdirSync(join(work,"tests"),{recursive:true});
  writeFileSync(join(work,"src","counter.js"),"export const count = 1;\n");
  const testSource='import {test} from "node:test";\nimport assert from "node:assert/strict";\nimport {count} from "../src/counter.js";\ntest("counter",()=>assert.equal(count,2));\n';
  writeFileSync(join(work,"tests","counter.test.js"),testSource);
  openLocalProfile(profile);
  return {root,work,profile,testSource,
    close:()=>rmSync(root,{recursive:true,force:true})};
};
const mockReply={message:{role:"assistant",content:JSON.stringify({
  replacement:"export const count = 2;\n",
  explanation:"Pas alleen de lokale teller aan.",
  checks:["Test de teller met node:test"],
})}};
test("Docker test status must match candidate and unchanged test file before approval",async()=>{
  const f=newWorkspace();const calls:DockerTestInput[]=[];
  const fake=createServer(async(req,res)=>{
    if(req.url!=="/api/chat"){res.writeHead(404);res.end();return}
    for await(const _ of req){}
    res.setHeader("content-type","application/json");
    res.end(JSON.stringify(mockReply));
  });
  await new Promise<void>(ok=>fake.listen(0,"127.0.0.1",ok));
  const port=(fake.address() as AddressInfo).port;
  const runner=async(input:DockerTestInput):Promise<DockerTestResult>=>{
    calls.push(input);
    return {status:"passed",runner:"docker-node-test-v1",candidateSha256:hash(input.candidateSource),
      testSha256:hash(input.testSource),imageId:"sha256:"+"a".repeat(64),
      testsExecuted:true,exitCode:0,timedOut:false,
      output:"TAP version 13\n# tests 1\n# pass 1\n# fail 0",
      recordedAt:new Date().toISOString()};
  };
  let demo:ReturnType<typeof createDemoServer>|null=null;
  try{
    const worker=new LocalCodeWorkspace({workspaceDir:f.work,profileDir:f.profile,
      host:"http://127.0.0.1:"+port,model:"local-test",testRunner:runner});
    demo=createDemoServer({codeWorkspace:worker,persistentDir:f.profile,schedulerIntervalMs:0});
    await new Promise<void>(ok=>demo!.server.listen(0,"127.0.0.1",ok));
    const address="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
    const post=(route:string,body:unknown)=>fetch(address+route,{
      method:"POST",headers:{Authorization:"Bearer "+demo!.token,
        "content-type":"application/json"},body:JSON.stringify(body)});
    const proposed=await post("/ops/code/propose",{path:"src/counter.js",
      instruction:"Set count to two",testPath:"tests/counter.test.js"});
    assert.equal(proposed.status,200);
    const draft=await proposed.json() as any;
    assert.equal(draft.testPath,"tests/counter.test.js");
    assert.equal(draft.preflight.status,"passed");
    const readAudit=async()=>fetch(address+"/ops/code/activity?proposalId="+encodeURIComponent(draft.id),
      {headers:{Authorization:"Bearer "+demo!.token}});
    const initialAudit=await readAudit();
    assert.equal(initialAudit.status,200);
    const initialEvents=(await initialAudit.json() as any).events;
    assert.deepEqual(initialEvents.map((x:any)=>x.event.action),["proposed"]);
    assert.equal(initialEvents[0].actor.kind,"person");
    assert.equal(initialEvents[0].event.replacementSha256,draft.replacementSha256);
    assert.equal(JSON.stringify(initialEvents).includes("export const"),false);
    assert.equal((await post("/ops/events",{type:"code.activity",proposalId:draft.id})).status,403);

    const before=await post("/ops/code/check",{proposalId:draft.id});
    assert.equal((await before.json() as any).canApply,false);
    const premature=await post("/ops/code/apply",{proposalId:draft.id,
      expectedSha256:draft.replacementSha256,approve:true});
    assert.equal(premature.status,409);
    assert.equal(readFileSync(join(f.work,"src","counter.js"),"utf8"),"export const count = 1;\n");
    const tested=await post("/ops/code/test",{proposalId:draft.id});
    assert.equal(tested.status,200);
    const result=await tested.json() as DockerTestResult;
    assert.equal(result.status,"passed");
    assert.equal(result.testsExecuted,true);
    const afterTestAudit=(await(await readAudit()).json() as any).events;
    assert.deepEqual(afterTestAudit.map((x:any)=>x.event.action),["proposed","tested"]);
    assert.equal(afterTestAudit[1].actor.kind,"check");
    assert.equal(afterTestAudit[1].event.testSha256,result.testSha256);

    assert.equal(calls.length,1);
    assert.equal(calls[0].candidateSource,"export const count = 2;\n");
    assert.equal(calls[0].testSource,f.testSource);
    const checked=await post("/ops/code/check",{proposalId:draft.id});
    const inspected=await checked.json() as any;
    assert.equal(inspected.canApply,true);
    assert.equal(inspected.testReport.testSha256,hash(f.testSource));
    const testFile=join(f.work,"tests","counter.test.js");
    writeFileSync(testFile,f.testSource+"\n// changed\n");
    assert.equal((await(await post("/ops/code/check",{proposalId:draft.id})).json() as any).canApply,false);
    assert.equal((await post("/ops/code/apply",{proposalId:draft.id,
      expectedSha256:draft.replacementSha256,approve:true})).status,409);
    writeFileSync(testFile,f.testSource);
    assert.equal((await(await post("/ops/code/check",{proposalId:draft.id})).json() as any).canApply,true);
    const applied=await post("/ops/code/apply",{proposalId:draft.id,
      expectedSha256:draft.replacementSha256,approve:true});
    assert.equal(applied.status,200);
    assert.equal((await applied.json() as any).testsExecuted,false,
      "apply response does not itself execute tests");
    assert.equal(readFileSync(join(f.work,"src","counter.js"),"utf8"),"export const count = 2;\n");
    const appliedAudit=(await(await readAudit()).json() as any).events;
    assert.deepEqual(appliedAudit.map((x:any)=>x.event.action),["proposed","tested","apply-started","applied"]);
    assert.equal(appliedAudit[2].actor.kind,"person");
    assert.equal(appliedAudit[2].event.result,"pending");
    assert.equal(appliedAudit[3].actor.kind,"person");
    assert.equal((await(await fetch(address+"/ops/code/recovery",
      {headers:{Authorization:"Bearer "+demo!.token}})).json() as any).blocked,false);
    assert.equal((await(await fetch(address+"/ops/verify",
      {headers:{Authorization:"Bearer "+demo!.token}})).json() as any).ok,true);

  }finally{if(demo)await demo.close();await new Promise<void>(ok=>fake.close(()=>ok()));f.close()}
});
test("bad Docker input is rejected without invoking a shell",async()=>{
  await assert.rejects(runIsolatedNodeTest({
    candidatePath:"../bad.js",candidateSource:"export const a=1;",
    testPath:"tests/good.test.js",testSource:"import {test} from 'node:test';test('ok',()=>{});"
  }),/Docker-test vereist/);
  await assert.rejects(runIsolatedNodeTest({
    candidatePath:"src/main.ts",candidateSource:"export const a=1;",
    testPath:"tests/good.test.js",testSource:"import {test} from 'node:test';test('ok',()=>{});"
  }),/Docker-test vereist/);
});

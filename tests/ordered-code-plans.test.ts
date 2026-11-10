import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import {mkdirSync,mkdtempSync,rmSync,writeFileSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import type {AddressInfo} from "node:net";
import {LocalCodeWorkspace} from "../packages/operations/src/code-worker.ts";
import {OrderedCodePlans} from "../packages/operations/src/ordered-code-plans.ts";
import type {DockerTestInput,DockerTestResult} from "../packages/operations/src/docker-code-test.ts";

const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
const check=(input:DockerTestInput,status:"passed"|"failed"="passed"):DockerTestResult=>({
  runner:"docker-node-test-v1",status,candidateSha256:hash(input.candidateSource),
  testSha256:hash(input.testSource),imageId:"sha256:"+"a".repeat(64),
  testsExecuted:true,exitCode:status==="passed"?0:1,timedOut:false,
  output:status,recordedAt:new Date().toISOString()
});
async function setup(){
  const root=mkdtempSync(join(tmpdir(),"eai-ordered-code-"));
  const project=join(root,"project"),profile=join(root,"profile");
  mkdirSync(join(project,"src"),{recursive:true});mkdirSync(join(project,"tests"));
  mkdirSync(profile);
  for(const key of ["one","two"]){
    writeFileSync(join(project,"src",key+".js"),"export const value = 1;\n");
    writeFileSync(join(project,"tests",key+".test.js"),"import {test} from 'node:test';\n");
  }
  let failAfterApply=false;
  const calls:Record<string,number>={};
  const server=createServer(async(req,res)=>{
    if(req.url!=="/api/chat"){res.writeHead(404);res.end();return}
    let raw="";for await(const chunk of req)raw+=chunk;
    const data=JSON.parse(raw);
    const request=JSON.parse(data.messages[0].content);
    const path=request.path;
    res.setHeader("content-type","application/json");
    res.end(JSON.stringify({message:{content:JSON.stringify({
      replacement:"export const value = 2;\n",explanation:"Zet de waarde op twee",
      checks:["Draai de bijbehorende test"]})}}));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const host="http://127.0.0.1:"+((server.address() as AddressInfo).port);
  const workspace=new LocalCodeWorkspace({workspaceDir:project,profileDir:profile,
    host,model:"mock",testRunner:async input=>{
      calls[input.candidatePath]=(calls[input.candidatePath]??0)+1;
      return check(input,failAfterApply&&input.candidatePath==="src/two.js"&&
        calls[input.candidatePath]>1?"failed":"passed");
    }});
  const plans=new OrderedCodePlans(workspace);
  const steps=["one","two"].map(key=>({path:"src/"+key+".js",
    testPath:"tests/"+key+".test.js",instruction:"Zet de waarde op twee"}));
  const close=async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));
    rmSync(root,{force:true,recursive:true})};
  return {plans,workspace,project,profile,steps,calls,close,
    failLast:()=>{failAfterApply=true}};
}
test("codeplan advances only after review, pretest, human apply and posttest",async()=>{
  const f=await setup();
  try{
    const plan=f.plans.create({title:"Twee gerichte wijzigingen",steps:f.steps},"person:tester");
    assert.equal(plan.nextStep,0);
    await assert.rejects(f.plans.exclusive(async()=>f.plans.assertProposal(plan.id,"fake","review")));
    const proposal=await f.workspace.propose(f.steps[0].path,f.steps[0].instruction,f.steps[0].testPath);
    f.plans.attachProposal(plan.id,proposal.id);
    assert.equal(f.plans.view(plan.id).steps[0].status,"review");
    assert.equal(f.plans.view(plan.id).steps[1].active,false);
    await f.workspace.runTests(proposal.id);
    assert.equal(f.workspace.inspect(proposal.id).canApply,true);
    f.plans.assertProposal(plan.id,proposal.id,"review");
    f.workspace.apply({proposalId:proposal.id,expectedSha256:proposal.replacementSha256,approve:true},"person:tester");
    assert.equal(f.plans.view(plan.id).steps[0].status,"needs-post-test");
    assert.equal(f.plans.view(plan.id).nextStep,0);
    const result=await f.workspace.runAppliedTests(proposal.id);
    f.plans.storePostTest(plan.id,proposal.id,result);
    assert.equal(f.plans.view(plan.id).nextStep,1);
    assert.equal(f.plans.view(plan.id).steps[0].status,"done");
    assert.equal(new OrderedCodePlans(f.workspace).view(plan.id).nextStep,1);
    const second=await f.workspace.propose(f.steps[1].path,f.steps[1].instruction,f.steps[1].testPath);
    f.plans.attachProposal(plan.id,second.id);
    await f.workspace.runTests(second.id);
    f.workspace.apply({proposalId:second.id,expectedSha256:second.replacementSha256,approve:true},"person:tester");
    f.plans.storePostTest(plan.id,second.id,await f.workspace.runAppliedTests(second.id));
    assert.equal(f.plans.view(plan.id).state,"done");
    assert.equal(f.calls["src/one.js"],2);
    assert.equal(f.calls["src/two.js"],2);
  }finally{await f.close()}
});
test("failed post-apply test blocks later files without changing them",async()=>{
  const f=await setup();
  try{
    const plan=f.plans.create({title:"Stop bij fout",steps:f.steps},"person:tester");
    const proposed=await f.workspace.propose(f.steps[0].path,f.steps[0].instruction,f.steps[0].testPath);
    f.plans.attachProposal(plan.id,proposed.id);
    await f.workspace.runTests(proposed.id);
    f.workspace.apply({proposalId:proposed.id,expectedSha256:proposed.replacementSha256,approve:true},"person:tester");
    const first=await f.workspace.runAppliedTests(proposed.id);
    f.plans.storePostTest(plan.id,proposed.id,first);
    const second=await f.workspace.propose(f.steps[1].path,f.steps[1].instruction,f.steps[1].testPath);
    f.plans.attachProposal(plan.id,second.id);
    await f.workspace.runTests(second.id);
    f.workspace.apply({proposalId:second.id,expectedSha256:second.replacementSha256,approve:true},"person:tester");
    f.failLast();
    const failed=await f.workspace.runAppliedTests(second.id);
    assert.equal(failed.status,"failed");
    const stopped=f.plans.storePostTest(plan.id,second.id,failed);
    assert.equal(stopped.state,"blocked");
    assert.equal(stopped.steps[1].status,"blocked");
    assert.throws(()=>f.plans.active(plan.id),/geblokkeerd/);
    assert.equal(readFileSync(join(f.project,"src","one.js"),"utf8"),"export const value = 2;\n");
    assert.equal(f.plans.stop(plan.id,"person:tester").state,"stopped");
  }finally{await f.close()}
});
test("plan rejects duplicate paths and stale or modified source bytes",async()=>{
  const f=await setup();
  try{
    assert.throws(()=>f.plans.create({title:"dubbel",steps:[f.steps[0],f.steps[0]]},"person:tester"),/uniek/);
    const plan=f.plans.create({title:"Bewaar bron",steps:f.steps},"person:tester");
    writeFileSync(join(f.project,"src","one.js"),"export const value = 99;\n");
    const view=f.plans.view(plan.id);
    assert.equal(view.state,"blocked");
    assert.equal(view.steps[0].status,"blocked");
    assert.equal(view.steps[1].status,"waiting");
  }finally{await f.close()}
});

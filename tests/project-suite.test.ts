import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import {mkdirSync,mkdtempSync,rmSync,writeFileSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {AddressInfo} from "node:net";
import {LocalCodeWorkspace} from "../packages/operations/src/code-worker.ts";
import {OrderedCodePlans} from "../packages/operations/src/ordered-code-plans.ts";
import {createDemoServer} from "../scripts/local-demo.ts";
import {projectManifestSha256,validateProjectInput,type ProjectTestInput,
  type ProjectTestResult} from "../packages/operations/src/docker-project-suite.ts";
import type {DockerTestInput,DockerTestResult} from "../packages/operations/src/docker-code-test.ts";

const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const sourceA='import {number} from "./b.js";\nexport const total = number;\n';
const replacementA='import {number} from "./b.js";\nexport const total = number + 1;\n';
const sourceB="export const number = 1;\n";
const replacementB="export const number = 2;\n";
function runnerResult(input:ProjectTestInput,status:"passed"|"failed"|"unavailable"):ProjectTestResult{
  return {runner:"docker-project-node-v1",proofFormat:"tap-named-v2",manifestSha256:projectManifestSha256(input),
    status,fileCount:input.files.length,testPaths:[...input.testPaths].sort(),
    testsExecuted:status!=="unavailable",exitCode:status==="passed"?0:status==="failed"?1:null,
    imageId:"sha256:"+"f".repeat(64),timedOut:false,output:status,
    recordedAt:new Date().toISOString()};
}
function oneFileResult(input:DockerTestInput):DockerTestResult{
  return {runner:"docker-node-test-v1",proofFormat:"tap-named-v2",status:"passed",
    candidateSha256:hash(input.candidateSource),testSha256:hash(input.testSource),
    imageId:"sha256:"+"e".repeat(64),testsExecuted:true,exitCode:0,
    timedOut:false,output:"passed",recordedAt:new Date().toISOString()};
}
async function setup(){
  const root=mkdtempSync(join(tmpdir(),"eai-project-suite-"));
  const project=join(root,"project"),profile=join(root,"profile");
  mkdirSync(join(project,"src"),{recursive:true});
  mkdirSync(join(project,"tests"),{recursive:true});
  mkdirSync(profile);
  writeFileSync(join(project,"src","a.js"),sourceA);
  writeFileSync(join(project,"src","b.js"),sourceB);
  writeFileSync(join(project,"tests","a.test.js"),
    'import {test} from "node:test";\nimport {total} from "../src/a.js";\ntest("a",()=>{});\n');
  writeFileSync(join(project,"tests","b.test.js"),
    'import {test} from "node:test";\nimport {number} from "../src/b.js";\ntest("b",()=>{});\n');
  const calls:ProjectTestInput[]=[];
  let failAt:number|null=null;
  const suiteRunner=async(input:ProjectTestInput)=>{
    calls.push(structuredClone(input));
    return runnerResult(input,calls.length===failAt?"failed":"passed");
  };
  const ollama=createServer(async(req,res)=>{
    if(req.url!=="/api/chat"){res.writeHead(404);res.end();return}
    let raw="";for await(const chunk of req)raw+=chunk;
    const request=JSON.parse(JSON.parse(raw).messages[0].content);
    res.setHeader("content-type","application/json");
    res.end(JSON.stringify({message:{content:JSON.stringify({
      replacement:request.path==="src/a.js"?replacementA:replacementB,
      explanation:"Pas de module aan en controleer de gezamenlijke tests.",
      checks:["Voer beide bestaande tests samen uit"]
    })}}));
  });
  await new Promise<void>(ok=>ollama.listen(0,"127.0.0.1",ok));
  const host="http://127.0.0.1:"+((ollama.address() as AddressInfo).port);
  const workspace=new LocalCodeWorkspace({workspaceDir:project,profileDir:profile,
    host,model:"mock",testRunner:async input=>oneFileResult(input)});
  const steps=["a","b"].map(letter=>({path:"src/"+letter+".js",
    testPath:"tests/"+letter+".test.js",instruction:"Pas deze module aan"}));
  const close=async()=>{await new Promise<void>(ok=>ollama.close(()=>ok()));
    rmSync(root,{recursive:true,force:true})};
  return {workspace,project,profile,steps,calls,suiteRunner,close,
    failCall:(number:number)=>{failAt=number}};
}
test("only explicit JavaScript files become part of a bounded suite manifest",()=>{
  const valid={files:[
    {path:"src/a.js",content:sourceA},
    {path:"src/b.js",content:sourceB},
    {path:"tests/a.test.js",content:"test('a',()=>{});"},
    {path:"tests/b.test.js",content:"test('b',()=>{});"}
  ],testPaths:["tests/a.test.js","tests/b.test.js"]};
  const digest=projectManifestSha256(valid);
  assert.match(digest,/^[a-f0-9]{64}$/);
  assert.equal(digest,projectManifestSha256({...valid,files:[...valid.files].reverse()}));
  assert.notEqual(digest,projectManifestSha256({...valid,files:[
    {...valid.files[0],content:replacementA},...valid.files.slice(1)
  ]}));
  assert.throws(()=>validateProjectInput({...valid,files:[
    {...valid.files[0],path:"../secret.js"},...valid.files.slice(1)
  ]}),/ongeldig|Ongeldig/);
  assert.throws(()=>validateProjectInput({...valid,testPaths:["tests/a.test.js","tests/a.test.js"]}),/ongeldig|Ongeldig/);
  assert.throws(()=>validateProjectInput({...valid,files:[valid.files[0],valid.files[0],...valid.files.slice(2)]}),/dubbel/);
  assert.throws(()=>validateProjectInput({...valid,files:[
    {...valid.files[0],path:"node_modules/x.js"},...valid.files.slice(1)
  ]}),/ongeldig|Ongeldig/);
});
test("independent acceptance can add a third test without a third source",()=>{
  const suite={files:[
    {path:"src/a.js",content:"export const a=1;"},
    {path:"src/b.js",content:"export const b=2;"},
    {path:"tests/a.test.js",content:"import {test} from 'node:test'; test('a',()=>{});"},
    {path:"tests/b.test.js",content:"import {test} from 'node:test'; test('b',()=>{});"},
    {path:"acceptance/final.test.js",content:"import {test} from 'node:test'; test('acceptance',()=>{});"}
  ],testPaths:["tests/a.test.js","tests/b.test.js","acceptance/final.test.js"]};
  assert.equal(validateProjectInput(suite).testPaths.length,3);
  assert.match(projectManifestSha256(suite),/^[a-f0-9]{64}$/);
  assert.throws(()=>validateProjectInput({...suite,files:suite.files.filter(f=>f.path!=="acceptance/final.test.js")}));
});
test("plan refuses the same test file twice before contacting Ollama",async()=>{
  const f=await setup();
  try{
    const plans=new OrderedCodePlans(f.workspace,{suiteRunner:f.suiteRunner});
    assert.throws(()=>plans.create({
      title:"Duplicate test",suitePolicy:"project-node-v1",
      steps:[f.steps[0],{...f.steps[1],testPath:f.steps[0].testPath}]
    },"person:tester"),/uniek/);
    assert.equal(f.calls.length,0);
  }finally{await f.close()}
});
test("combined suite covers imports and gates every step before and after apply",async()=>{
  const f=await setup();
  const plans=new OrderedCodePlans(f.workspace,{suiteRunner:f.suiteRunner});
  try{
    const created=plans.create({title:"Cross-file",steps:f.steps,suitePolicy:"project-node-v1"},"person:tester");
    const id=created.id;
    for(const letter of ["a","b"]){
      const current=plans.active(id);
      assert.equal(current.status,"waiting");
      const proposal=await f.workspace.propose(current.step.path,current.step.instruction,current.step.testPath);
      plans.attachProposal(id,proposal.id);
      assert.equal(plans.projectPreApproved(id,proposal.id),false);
      const pre=await plans.runProjectSuite(id,proposal.id,"pre");
      assert.equal(pre.result.status,"passed");
      assert.equal(plans.projectPreApproved(id,proposal.id),true);
      f.workspace.apply({proposalId:proposal.id,expectedSha256:proposal.replacementSha256,approve:true},
        "person:tester",{projectSuiteApproved:true});
      assert.equal(plans.view(id).steps[current.index].status,"needs-project-test");
      const post=await plans.runProjectSuite(id,proposal.id,"post");
      assert.equal(post.result.status,"passed");
      assert.equal(post.plan.steps[current.index].status,"done");
    }
    assert.equal(plans.view(id).state,"done");
    assert.equal(f.calls.length,4);
    const staged=(input:ProjectTestInput,path:string)=>input.files.find(file=>file.path===path)?.content;
    assert.equal(staged(f.calls[0],"src/a.js"),replacementA);
    assert.equal(staged(f.calls[0],"src/b.js"),sourceB);
    assert.equal(staged(f.calls[1],"src/a.js"),replacementA);
    assert.equal(staged(f.calls[2],"src/a.js"),replacementA);
    assert.equal(staged(f.calls[2],"src/b.js"),replacementB);
    assert.equal(staged(f.calls[3],"src/b.js"),replacementB);
    assert.equal(new OrderedCodePlans(f.workspace,{suiteRunner:f.suiteRunner}).view(id).state,"done");
    const verified=plans.view(id);
    assert.equal(verified.proof.status,"current");
    assert.match(verified.proof.manifestSha256||"",/^[a-f0-9]{64}$/);
    writeFileSync(join(f.project,"src","a.js"),"export const total = 999;\n");
    assert.equal(plans.view(id).state,"blocked");
    assert.equal(plans.view(id).proof.status,"stale");
    assert.equal(new OrderedCodePlans(f.workspace,{suiteRunner:f.suiteRunner}).view(id).proof.status,"stale");
  }finally{await f.close()}
});
test("failed joint post-test halts later files without overwriting them",async()=>{
  const f=await setup();
  const plans=new OrderedCodePlans(f.workspace,{suiteRunner:f.suiteRunner});
  try{
    f.failCall(2);
    const id=plans.create({title:"Fail closed",steps:f.steps,suitePolicy:"project-node-v1"},"person:tester").id;
    const proposal=await f.workspace.propose(f.steps[0].path,f.steps[0].instruction,f.steps[0].testPath);
    plans.attachProposal(id,proposal.id);
    await plans.runProjectSuite(id,proposal.id,"pre");
    f.workspace.apply({proposalId:proposal.id,expectedSha256:proposal.replacementSha256,approve:true},
      "person:tester",{projectSuiteApproved:true});
    const post=await plans.runProjectSuite(id,proposal.id,"post");
    assert.equal(post.result.status,"failed");
    assert.equal(post.plan.state,"blocked");
    assert.throws(()=>plans.active(id),/geblokkeerd/);
    assert.equal(readFileSync(join(f.project,"src","a.js"),"utf8"),replacementA);
    assert.equal(readFileSync(join(f.project,"src","b.js"),"utf8"),sourceB);
  }finally{await f.close()}
});
test("project check rejects stale source or test files and cannot authorize apply",async()=>{
  const f=await setup();
  const plans=new OrderedCodePlans(f.workspace,{suiteRunner:f.suiteRunner});
  try{
    const id=plans.create({title:"Stale input",steps:f.steps,suitePolicy:"project-node-v1"},"person:tester").id;
    const proposal=await f.workspace.propose(f.steps[0].path,f.steps[0].instruction,f.steps[0].testPath);
    plans.attachProposal(id,proposal.id);
    await plans.runProjectSuite(id,proposal.id,"pre");
    writeFileSync(join(f.project,"src","b.js"),"export const number = 999;\n");
    assert.equal(plans.view(id).state,"blocked");
    assert.throws(()=>plans.projectPreApproved(id,proposal.id),/geblokkeerd/);
    assert.equal(readFileSync(join(f.project,"src","a.js"),"utf8"),sourceA);
  }finally{await f.close()}
});
test("local API logs the exact project manifest and rejects untested apply",async()=>{
  const f=await setup();
  const app=createDemoServer({codeWorkspace:f.workspace,persistentDir:f.profile,
    schedulerIntervalMs:0,projectSuiteRunner:f.suiteRunner});
  try{
    await new Promise<void>(ok=>app.server.listen(0,"127.0.0.1",ok));
    const origin="http://127.0.0.1:"+((app.server.address() as AddressInfo).port);
    const request=async(path:string,body?:unknown)=>{
      const response=await fetch(origin+path,{
        method:body===undefined?"GET":"POST",
        headers:{Authorization:"Bearer "+app.token,...(body===undefined?{}:{"content-type":"application/json"})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})
      });
      return {status:response.status,data:await response.json()};
    };
    const created=await request("/ops/code/plans",{title:"Via API",steps:f.steps,
      suitePolicy:"project-node-v1"});
    assert.equal(created.status,200);
    const planId=created.data.id;
    assert.equal(created.data.suitePolicy,"project-node-v1");
    const proposed=await request("/ops/code/plan/propose",{planId});
    assert.equal(proposed.status,200);
    const proposalId=proposed.data.proposalId;
    const inspected=await request("/ops/code/proposal?id="+proposalId);
    assert.equal(inspected.status,200);
    const approval={planId,proposalId,
      expectedSha256:inspected.data.replacementSha256,approve:true};
    assert.equal((await request("/ops/code/plan/apply",approval)).status,409);
    assert.equal((await request("/ops/code/plan/test-project-post",{planId,proposalId})).status,409);
    const pre=await request("/ops/code/plan/test-project-pre",{planId,proposalId});
    assert.equal(pre.status,200);
    assert.equal(pre.data.result.status,"passed");
    const applied=await request("/ops/code/plan/apply",approval);
    assert.equal(applied.status,200);
    assert.equal(applied.data.plan.steps[0].status,"needs-project-test");
    assert.equal((await request("/ops/code/plan/propose",{planId})).status,409);
    const post=await request("/ops/code/plan/test-project-post",{planId,proposalId});
    assert.equal(post.status,200);
    assert.equal(post.data.plan.nextStep,1);
    assert.equal(readFileSync(join(f.project,"src","b.js"),"utf8"),sourceB);
    const activity=await request("/ops/code/activity?proposalId="+proposalId);
    assert.equal(activity.status,200);
    const events=activity.data.events.map((row:any)=>row.event);
    assert.deepEqual(events.map((event:any)=>event.action),
      ["proposed","suite-tested","apply-started","applied","suite-tested"]);
    assert.equal(events[1].projectManifestSha256,pre.data.result.manifestSha256);
    assert.equal(events[4].projectManifestSha256,post.data.result.manifestSha256);
    assert.equal((await request("/ops/verify")).data.ok,true);
  }finally{
    await app.close();
    await f.close();
  }
});

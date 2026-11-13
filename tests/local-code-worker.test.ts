import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,symlinkSync,existsSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {openLocalProfile} from "../scripts/local-profile.ts";
import {LocalCodeWorkspace} from "../packages/operations/src/code-worker.ts";
import {startLocalOllama} from "../scripts/local-ollama.ts";

const workspace=()=>{
 const parent=mkdtempSync(join(tmpdir(),"eaiwork-code-test-"));
 const work=join(parent,"work"),profile=join(parent,"profile");
 mkdirSync(join(work,"src"),{recursive:true});
 writeFileSync(join(work,"src","counter.ts"),"export const count = 1;\n");
 openLocalProfile(profile);
 return {parent,work,profile,file:join(work,"src","counter.ts"),
   close:()=>rmSync(parent,{recursive:true,force:true})};
};
const reply=()=>({message:{role:"assistant",content:JSON.stringify({
 replacement:"export const count = 2;\n",
 explanation:"De teller krijgt de nieuwe waarde.",
 checks:["Controleer de bestaande unittests handmatig"],
})}});
test("code worker never writes before explicit human approval; verifies source hash and keeps backup",async()=>{
 const f=workspace();
 const requests:any[]=[];
 let invalidSyntax=false;
 const fake=createServer(async(req,res)=>{
  if(req.url==="/api/tags")return void res.end(JSON.stringify({models:[{name:"test-model"}]}));
  if(req.url==="/api/chat"){
    let body="";
    for await(const chunk of req)body+=chunk.toString("utf8");
    requests.push(JSON.parse(body));
    res.setHeader("content-type","application/json");
    return void res.end(JSON.stringify(invalidSyntax?
      {message:{role:"assistant",content:JSON.stringify({
        replacement:"export const count: number = ;",
        explanation:"Ongeldige code voor een afwijzingsproef.",
        checks:["Controleer de code zelf"]
      })}}:reply()));
  }
  res.writeHead(404);res.end();
 });
 await new Promise<void>(done=>fake.listen(0,"127.0.0.1",done));
 const port=(fake.address() as AddressInfo).port;
 let app:Awaited<ReturnType<typeof startLocalOllama>>|undefined;
 try{
  app=await startLocalOllama({host:"http://127.0.0.1:"+port,model:"test-model",
    worktreeDir:f.work,dataDir:f.profile,port:0});
  const base=app.address.slice(0,-"/dashboard".length);
  const post=(path:string,body:unknown,token=app!.token)=>fetch(base+path,{
    method:"POST",headers:{"content-type":"application/json",Authorization:"Bearer "+token},
    body:JSON.stringify(body)
  });
  const state=await fetch(base+"/ops/code/workspace",{headers:{Authorization:"Bearer "+app.token}});
  assert.equal(state.status,200);
  assert.equal((await state.json() as any).enabled,true);
  assert.equal(requests.length,0);
  assert.equal((await post("/ops/code/propose",{path:"../secret.env",instruction:"Change it"})).status,422);
  assert.equal((await post("/ops/code/propose",{path:".git/config",instruction:"Change it"})).status,422);
  assert.equal((await post("/ops/code/propose",{path:"src/counter.ts",instruction:"Change it"},"bad")).status!==200,true);
  const result=await post("/ops/code/propose",{path:"src/counter.ts",instruction:"Change the counter to two"});
  assert.equal(result.status,200);
  const proposal=await result.json() as any;
  assert.equal(proposal.status,"requires-human-review");
  assert.equal(proposal.path,"src/counter.ts");
  assert.equal(proposal.modelId,"ollama:test-model");
  assert.equal(proposal.preflight.status,"passed");
  assert.equal(proposal.preflight.testsExecuted,false);
  const checked=await post("/ops/code/check",{proposalId:proposal.id});
  assert.equal(checked.status,200);
  const inspection=await checked.json() as any;
  assert.equal(inspection.canApply,true);
  assert.equal(inspection.sourceUnchanged,true);
  assert.equal(inspection.preflight.status,"passed");
  assert.equal(inspection.testsExecuted,false);
  const review=await fetch(base+"/ops/code/proposal?id="+proposal.id,{headers:{Authorization:"Bearer "+app.token}});
  assert.equal(review.status,200);
  const reviewData=await review.json() as any;
  assert.equal(reviewData.canApply,true);
  assert.ok(reviewData.comparison.lines.some((line:any)=>line.kind==="added"));
  assert.ok(reviewData.comparison.lines.some((line:any)=>line.kind==="removed"));
  const history=await fetch(base+"/ops/code/proposals",{headers:{Authorization:"Bearer "+app.token}});
  assert.equal(history.status,200);
  assert.equal((await history.json() as any).proposals[0].id,proposal.id);
  assert.equal(readFileSync(f.file,"utf8"),"export const count = 1;\n");
  assert.equal(requests.length,1);
  assert.equal(JSON.stringify(requests[0]).includes(app.token),false);
  assert.equal(JSON.parse(requests[0].messages[0].content).path,"src/counter.ts");
  assert.equal((await post("/ops/code/apply",{proposalId:proposal.id,expectedSha256:"0".repeat(64),approve:true})).status,409);
  assert.equal((await post("/ops/code/apply",{proposalId:proposal.id,expectedSha256:proposal.replacementSha256,approve:false})).status,409);
  writeFileSync(f.file,"export const count = 3;\n");
  const staleCheck=await post("/ops/code/check",{proposalId:proposal.id});
  assert.equal((await staleCheck.json() as any).canApply,false);
  assert.equal((await post("/ops/code/apply",{proposalId:proposal.id,expectedSha256:proposal.replacementSha256,approve:true})).status,409);
  writeFileSync(f.file,"export const count = 1;\n");
  const approved=await post("/ops/code/apply",{
    proposalId:proposal.id,expectedSha256:proposal.replacementSha256,approve:true});
  assert.equal(approved.status,200);
  const applied=await approved.json() as any;
  assert.equal(applied.status,"applied");
  assert.equal(applied.testsExecuted,false);
  assert.equal(readFileSync(f.file,"utf8"),"export const count = 2;\n");
  assert.equal(readFileSync(join(f.profile,"code-proposals",proposal.id+".original"),"utf8"),"export const count = 1;\n");
  assert.equal((await post("/ops/code/apply",{proposalId:proposal.id,expectedSha256:proposal.replacementSha256,approve:true})).status,409);
  invalidSyntax=true;
  const bad=await post("/ops/code/propose",{path:"src/counter.ts",instruction:"Introduce syntax error for test"});
  assert.equal(bad.status,200);
  const badProposal=await bad.json() as any;
  assert.equal(badProposal.preflight.status,"failed");
  const badCheck=await post("/ops/code/check",{proposalId:badProposal.id});
  assert.equal((await badCheck.json() as any).canApply,false);
  assert.equal((await post("/ops/code/apply",{proposalId:badProposal.id,expectedSha256:badProposal.replacementSha256,approve:true})).status,409);
  assert.equal(readFileSync(f.file,"utf8"),"export const count = 2;\n");
  const appliedReview=await fetch(base+"/ops/code/proposal?id="+proposal.id,{headers:{Authorization:"Bearer "+app.token}});
  assert.equal((await appliedReview.json() as any).canRestore,true);
  writeFileSync(f.file,"export const count = 4;\n");
  assert.equal((await post("/ops/code/restore",{
    proposalId:proposal.id,expectedSha256:proposal.replacementSha256,approve:true})).status,409);
  writeFileSync(f.file,"export const count = 2;\n");
  const restored=await post("/ops/code/restore",{
    proposalId:proposal.id,expectedSha256:proposal.replacementSha256,approve:true});
  assert.equal(restored.status,200);
  assert.equal((await restored.json() as any).status,"restored");
  assert.equal(readFileSync(f.file,"utf8"),"export const count = 1;\n");
  assert.equal((await post("/ops/code/restore",{
    proposalId:proposal.id,expectedSha256:proposal.replacementSha256,approve:true})).status,409);
  const afterRestore=await fetch(base+"/ops/code/proposal?id="+proposal.id,{headers:{Authorization:"Bearer "+app.token}});
  assert.equal((await afterRestore.json() as any).status,"restored");
 }finally{
  if(app)await app.close();
  await new Promise<void>(done=>fake.close(()=>done()));
  f.close();
 }
});
test("worker rejects symlinks and non-code targets without calling model",async()=>{
 const f=workspace();
 try{
  const instance=new LocalCodeWorkspace({workspaceDir:f.work,profileDir:f.profile,model:"test-model"});
  symlinkSync(f.file,join(f.work,"src","link.ts"));
  await assert.rejects(instance.propose("src/link.ts","Change the number"),/Symbolische links/);
  await assert.rejects(instance.propose("src/counter.txt","Change text"),/Bestandstype/);
  await assert.rejects(instance.propose("/etc/passwd","Change file"),/relatief/);
  await assert.rejects(instance.propose("src/../counter.ts","Change file"),/bestandspad/);
  assert.equal(readFileSync(f.file,"utf8"),"export const count = 1;\n");
 }finally{f.close()}
});

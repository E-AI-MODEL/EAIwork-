import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {LocalCodeWorkspace} from "../packages/operations/src/code-worker.ts";
import {createDemoServer} from "../scripts/local-demo.ts";

function fixture(){
  const root=mkdtempSync(join(tmpdir(),"eai-code-recovery-"));
  const project=join(root,"project"),profile=join(root,"profile"),file=join(project,"src","counter.js");
  mkdirSync(join(project,"src"),{recursive:true});
  mkdirSync(profile);
  const source="export const count = 1;\n";
  const target="export const count = 2;\n";
  writeFileSync(file,source);
  return {root,project,profile,file,source,target,clean:()=>rmSync(root,{recursive:true,force:true})};
}
async function ollamaStub(){
  const http=createServer(async(req,res)=>{
    if(req.url!=="/api/chat"){res.writeHead(404);res.end();return}
    for await(const _ of req){}
    res.setHeader("content-type","application/json");
    res.end(JSON.stringify({message:{role:"assistant",content:JSON.stringify({
      replacement:"export const count = 2;\n",
      explanation:"Verander de teller en controleer de uitkomst zelf.",
      checks:["Controleer bestaande tests"],
    })}}));
  });
  await new Promise<void>(ok=>http.listen(0,"127.0.0.1",ok));
  return {url:"http://127.0.0.1:"+((http.address() as AddressInfo).port),
    close:()=>new Promise<void>(ok=>http.close(()=>ok()))};
}
function connect(f:ReturnType<typeof fixture>,url:string){
  const worker=new LocalCodeWorkspace({workspaceDir:f.project,profileDir:f.profile,
    model:"mock-local",host:url});
  const demo=createDemoServer({codeWorkspace:worker,persistentDir:f.profile,schedulerIntervalMs:0});
  return {worker,demo,start:async()=>{
    await new Promise<void>(ok=>demo.server.listen(0,"127.0.0.1",ok));
    const origin="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port);
    return {
      get:async(path:string)=>fetch(origin+path,{headers:{Authorization:"Bearer "+demo.token}}),
      post:async(path:string,body:unknown)=>fetch(origin+path,{method:"POST",
        headers:{Authorization:"Bearer "+demo.token,"content-type":"application/json"},
        body:JSON.stringify(body)})
    };
  }};
}
test("interrupted apply on unchanged file blocks work and is cancelled after restart",async()=>{
  const f=fixture(),stub=await ollamaStub();
  let first:ReturnType<typeof connect>|undefined,second:ReturnType<typeof connect>|undefined;
  try{
    first=connect(f,stub.url);const api=await first.start();
    const p=await api.post("/ops/code/propose",{path:"src/counter.js",instruction:"Zet de teller op twee"});
    assert.equal(p.status,200);const draft=await p.json() as any;
    (first.worker as any).apply=()=>{
      // A backup was already created, but the source rename did not happen.
      writeFileSync(join(f.profile,"code-proposals",draft.id+".original"),f.source);
      throw Error("simulated crash after writing the original backup");
    };
    assert.equal((await api.post("/ops/code/apply",
      {proposalId:draft.id,expectedSha256:draft.replacementSha256,approve:true})).status,409);
    assert.equal(readFileSync(f.file,"utf8"),f.source);
    assert.equal((await api.get("/ops/code/recovery")).status,200);
    const pending=(await(await api.get("/ops/code/recovery")).json() as any);
    assert.equal(pending.blocked,true);
    assert.equal(pending.pending[0].outcome,"aborted");
    assert.equal((await api.post("/ops/code/apply",
      {proposalId:draft.id,expectedSha256:draft.replacementSha256,approve:true})).status,409);
    await first.demo.close();first=undefined;
    second=connect(f,stub.url);const reopened=await second.start();
    assert.equal((await(await reopened.get("/ops/code/recovery")).json() as any).blocked,true);
    const recovery=await reopened.post("/ops/code/recover",{proposalId:draft.id,approve:true});
    assert.equal(recovery.status,200);
    assert.equal((await recovery.json() as any).outcome,"aborted");
    assert.equal((await(await reopened.get("/ops/code/recovery")).json() as any).blocked,false);
    const applied=await reopened.post("/ops/code/apply",
      {proposalId:draft.id,expectedSha256:draft.replacementSha256,approve:true});
    assert.equal(applied.status,200);
    assert.equal(readFileSync(f.file,"utf8"),f.target);
    const activity=(await(await reopened.get("/ops/code/activity?proposalId="+draft.id)).json() as any).events;
    assert.deepEqual(activity.map((e:any)=>e.event.action),
      ["proposed","apply-started","aborted","apply-started","applied"]);
    assert.equal((await(await reopened.get("/ops/verify")).json() as any).ok,true);
  }finally{
    if(first)await first.demo.close();
    if(second)await second.demo.close();
    await stub.close();f.clean();
  }
});
test("crash after source rename but before proposal record is safely reconciled",async()=>{
  const f=fixture(),stub=await ollamaStub();
  let first:ReturnType<typeof connect>|undefined,second:ReturnType<typeof connect>|undefined;
  try{
    first=connect(f,stub.url);const api=await first.start();
    const proposal=await(await api.post("/ops/code/propose",
      {path:"src/counter.js",instruction:"Zet teller op twee"})).json() as any;
    (first.worker as any).apply=(request:any)=>{
      // Exact disk state after a successful file rename but before proposal JSON is committed.
      writeFileSync(join(f.profile,"code-proposals",request.proposalId+".original"),f.source);
      writeFileSync(f.file,f.target);
      throw Error("simulated crash after rename");
    };
    assert.equal((await api.post("/ops/code/apply",
      {proposalId:proposal.id,expectedSha256:proposal.replacementSha256,approve:true})).status,409);
    await first.demo.close();first=undefined;
    second=connect(f,stub.url);const reopened=await second.start();
    const status=(await(await reopened.get("/ops/code/recovery")).json() as any).pending[0];
    assert.equal(status.outcome,"applied");
    assert.equal((await reopened.post("/ops/code/recover",
      {proposalId:proposal.id,approve:false})).status,422);
    const finished=await reopened.post("/ops/code/recover",{proposalId:proposal.id,approve:true});
    assert.equal(finished.status,200);
    assert.equal((await finished.json() as any).outcome,"applied");
    assert.equal(readFileSync(f.file,"utf8"),f.target);
    const reviewed=(await(await reopened.get("/ops/code/proposal?id="+proposal.id)).json() as any);
    assert.equal(reviewed.status,"applied");
    assert.equal((await(await reopened.get("/ops/code/recovery")).json() as any).blocked,false);
    assert.deepEqual((await(await reopened.get("/ops/code/activity?proposalId="+proposal.id)).json() as any)
      .events.map((e:any)=>e.event.action),["proposed","apply-started","applied"]);
  }finally{
    if(first)await first.demo.close();if(second)await second.demo.close();
    await stub.close();f.clean();
  }
});
test("unexpected source after crash stays blocked without overwriting files",async()=>{
  const f=fixture(),stub=await ollamaStub();
  let first:ReturnType<typeof connect>|undefined,second:ReturnType<typeof connect>|undefined;
  try{
    first=connect(f,stub.url);const api=await first.start();
    const proposal=await(await api.post("/ops/code/propose",
      {path:"src/counter.js",instruction:"Zet teller op twee"})).json() as any;
    (first.worker as any).apply=()=>{throw Error("simulated crash")};
    assert.equal((await api.post("/ops/code/apply",
      {proposalId:proposal.id,expectedSha256:proposal.replacementSha256,approve:true})).status,409);
    await first.demo.close();first=undefined;
    writeFileSync(f.file,"export const count = 99;\n");
    second=connect(f,stub.url);const reopened=await second.start();
    const pending=(await(await reopened.get("/ops/code/recovery")).json() as any).pending;
    assert.equal(pending[0].outcome,"manual-required");
    assert.equal((await reopened.post("/ops/code/recover",
      {proposalId:proposal.id,approve:true})).status,409);
    assert.equal(readFileSync(f.file,"utf8"),"export const count = 99;\n");
    assert.equal((await(await reopened.get("/ops/code/recovery")).json() as any).blocked,true);
  }finally{
    if(first)await first.demo.close();if(second)await second.demo.close();
    await stub.close();f.clean();
  }
});

test("interrupted restore is reconciled without applying the same source twice",async()=>{
  const f=fixture(),stub=await ollamaStub();
  let first:ReturnType<typeof connect>|undefined,second:ReturnType<typeof connect>|undefined;
  try{
    first=connect(f,stub.url);const api=await first.start();
    const proposal=await(await api.post("/ops/code/propose",
      {path:"src/counter.js",instruction:"Zet teller op twee"})).json() as any;
    assert.equal((await api.post("/ops/code/apply",
      {proposalId:proposal.id,expectedSha256:proposal.replacementSha256,approve:true})).status,200);
    assert.equal(readFileSync(f.file,"utf8"),f.target);
    (first.worker as any).restore=()=>{
      writeFileSync(f.file,f.source);
      throw Error("simulated crash after source restore");
    };
    assert.equal((await api.post("/ops/code/restore",
      {proposalId:proposal.id,expectedSha256:proposal.replacementSha256,approve:true})).status,409);
    await first.demo.close();first=undefined;
    second=connect(f,stub.url);const reopened=await second.start();
    const pending=(await(await reopened.get("/ops/code/recovery")).json() as any).pending[0];
    assert.equal(pending.action,"restore-started");
    assert.equal(pending.outcome,"restored");
    assert.equal((await reopened.post("/ops/code/recover",
      {proposalId:proposal.id,approve:true})).status,200);
    const current=(await(await reopened.get("/ops/code/proposal?id="+proposal.id)).json() as any);
    assert.equal(current.status,"restored");
    assert.equal(readFileSync(f.file,"utf8"),f.source);
    assert.equal((await(await reopened.get("/ops/code/recovery")).json() as any).blocked,false);
    assert.deepEqual((await(await reopened.get("/ops/code/activity?proposalId="+proposal.id)).json() as any)
      .events.map((e:any)=>e.event.action),
      ["proposed","apply-started","applied","restore-started","restored"]);
  }finally{
    if(first)await first.demo.close();if(second)await second.demo.close();
    await stub.close();f.clean();
  }
});

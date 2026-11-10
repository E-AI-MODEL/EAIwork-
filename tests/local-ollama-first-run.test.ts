import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {chooseInstalledModel,parseLocalOllamaArgs,startLocalOllama} from "../scripts/local-ollama.ts";

test("Ollama launcher rejects remote hosts, ambiguous models and unsafe flags",()=>{
  assert.equal(chooseInstalledModel(["qwen2.5:1.5b"],undefined),"qwen2.5:1.5b");
  assert.equal(chooseInstalledModel(["a","b"],"b"),"b");
  assert.throws(()=>chooseInstalledModel([],undefined),/Geen Ollama-modellen/);
  assert.throws(()=>chooseInstalledModel(["a","b"],undefined),/Kies een lokaal model/);
  assert.throws(()=>chooseInstalledModel(["a"],"b"),/niet lokaal geinstalleerd/);
  assert.throws(()=>parseLocalOllamaArgs(["--host=http://192.168.1.10:11434"],{}),/local loopback/);
  assert.throws(()=>parseLocalOllamaArgs(["--model=qwen:1b","--model=qwen:2b"],{}),/Gebruik/);
  assert.throws(()=>parseLocalOllamaArgs(["--port=0"],{}),/Dashboardpoort/);
  assert.throws(()=>parseLocalOllamaArgs(["--timeout-ms=999999"],{}),/timeout/);
  assert.throws(()=>parseLocalOllamaArgs(["--token=abc"],{}),/Gebruik/);
  assert.deepEqual(parseLocalOllamaArgs(["--model=qwen2.5:1.5b"],{}),{
    host:"http://127.0.0.1:11434",model:"qwen2.5:1.5b",port:8788,timeoutMs:90000,
  });
});
test("real loopback EAIwork server uses stub Ollama only for human-reviewed planning",async()=>{
  const modelPrompts:unknown[]=[];
  const fakeOllama=createServer(async(req,res)=>{
    if(req.method==="GET"&&req.url==="/api/tags"){
      res.writeHead(200,{"content-type":"application/json"});
      return res.end(JSON.stringify({models:[{name:"qwen2.5:1.5b"},{name:"llama3.2:1b"}]}));
    }
    if(req.method==="POST"&&req.url==="/api/chat"){
      let data="";
      for await(const chunk of req)data+=chunk.toString("utf8");
      const call=JSON.parse(data);
      modelPrompts.push(call);
      const content=JSON.stringify({
        title:"Lokaal tekstplan",goal:"Tekst uitsluitend lokaal opschonen",
        tasks:[{id:"task-clean",title:"Tekst normaliseren",taskKind:"text-normalize",
          dependsOn:[],input:{text:"  Lokaal   plan  "}}],
        phases:[{id:"phase-run",title:"Lokaal uitvoeren",taskIds:["task-clean"]}],
        constraints:[],missingInformation:[],
      });
      res.writeHead(200,{"content-type":"application/json"});
      return res.end(JSON.stringify({message:{role:"assistant",content}}));
    }
    res.writeHead(404);res.end();
  });
  await new Promise<void>(ok=>fakeOllama.listen(0,"127.0.0.1",ok));
  const ollamaPort=(fakeOllama.address() as AddressInfo).port;
  let demo:Awaited<ReturnType<typeof startLocalOllama>>|undefined;
  try{
    demo=await startLocalOllama({host:"http://127.0.0.1:"+ollamaPort,
      model:"qwen2.5:1.5b",port:0});
    assert.equal(demo.model,"qwen2.5:1.5b");
    assert.match(demo.address,/^http:\/\/127\.0\.0\.1:\d+\/dashboard$/);
    const base=demo.address.slice(0,-"/dashboard".length);
    const req=(path:string,method="GET",data?:unknown,token=demo!.token)=>fetch(base+path,{
      method,headers:{Authorization:"Bearer "+token,...(data?{"content-type":"application/json"}:{})},
      ...(data?{body:JSON.stringify(data)}:{}),
    });
    assert.equal((await req("/ops/model","GET",undefined,"invalid")).status!==200,true);
    const status=await req("/ops/model");
    assert.equal(status.status,200);
    assert.deepEqual(await status.json(),{
      configured:true,modelId:"ollama:qwen2.5:1.5b",role:"proposal-only",health:"not-checked",
    });
    assert.equal(modelPrompts.length,0,"the model must not run simply by opening dashboard");
    assert.equal((await req("/dashboard")).status,200);
    const instruction="Maak een lokaal plan om de tekst op te schonen. Geen publicatie.";
    const draft=await req("/ops/plans/propose","POST",{instruction});
    assert.equal(draft.status,200);
    const proposal=await draft.json() as any;
    assert.equal(proposal.status,"requires-human-review");
    assert.equal(proposal.modelId,"ollama:qwen2.5:1.5b");
    assert.equal(proposal.constraintCoverage,"not-evaluated");
    assert.equal(proposal.plan.sourceInstruction,instruction);
    assert.equal(proposal.preflight.status,"requires-human-review");
    assert.equal(modelPrompts.length,1);
    const modelCall=modelPrompts[0] as any;
    assert.equal(modelCall.model,"qwen2.5:1.5b");
    assert.equal(modelCall.stream,false);
    assert.equal(JSON.parse(modelCall.messages[0].content).sourceInstruction,instruction);
    assert.equal(JSON.stringify(modelCall).includes(demo.token),false,"authorization token must never reach Ollama");
    const before=await(await req("/ops/missions")).json() as any;
    assert.equal(before.missions[proposal.plan.id],undefined,"model cannot approve its own plan");
    assert.equal((await req("/ops/missions","POST",{plan:proposal.plan})).status,201);
    const run=await req("/ops/missions/"+proposal.plan.id+"/run","POST",{});
    assert.equal(run.status,200);
    const after=await(await req("/ops/missions")).json() as any;
    assert.equal(after.missions[proposal.plan.id].tasks["task-clean"].status,"done");
    assert.equal(after.missions[proposal.plan.id].tasks["task-clean"].run.verification,"not-evaluated");
    assert.equal((await req("/ops/verify")).status,200);
  }finally{
    if(demo)await demo.close();
    await new Promise<void>(done=>fakeOllama.close(()=>done()));
  }
});

import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {AddressInfo} from "node:net";
import {LocalCodeWorkspace} from "../packages/operations/src/code-worker.ts";
import {createDemoServer} from "../scripts/local-demo.ts";
import type {DockerConnectionStatus} from "../packages/operations/src/local-docker-status.ts";

test("connection panel checks real model discovery separately from authorization and Docker",async()=>{
  const root=mkdtempSync(join(tmpdir(),"eaiwork-connection-test-"));
  const worktree=join(root,"worktree"),profile=join(root,"profile");
  mkdirSync(worktree);mkdirSync(profile);
  let names=["gemma2:latest","tiny:latest"];
  let requests=0;
  const ollama=createServer((req,res)=>{
    requests++;
    if(req.method!=="GET"||req.url!=="/api/tags"){res.writeHead(404);return res.end()}
    res.setHeader("content-type","application/json");
    res.end(JSON.stringify({models:names.map(name=>({name}))}));
  });
  await new Promise<void>(resolve=>ollama.listen(0,"127.0.0.1",resolve));
  const host="http://127.0.0.1:"+((ollama.address() as AddressInfo).port);
  let docker:DockerConnectionStatus={status:"ready",detail:"Docker image available"};
  const workspace=new LocalCodeWorkspace({workspaceDir:worktree,profileDir:profile,
    host,model:"gemma2:latest"});
  const demo=createDemoServer({codeWorkspace:workspace,persistentDir:profile,
    schedulerIntervalMs:0,dockerConnectionProbe:()=>docker});
  try{
    await new Promise<void>(resolve=>demo.server.listen(0,"127.0.0.1",resolve));
    const url="http://127.0.0.1:"+((demo.server.address() as AddressInfo).port)+"/ops/connections";
    const unauthorized=await fetch(url);
    assert.equal(unauthorized.status,401);
    assert.equal(requests,0,"an unauthorized user must not trigger any probes");
    const check=()=>fetch(url,{headers:{Authorization:"Bearer "+demo.token}});
    const response=await check();
    assert.equal(response.status,200);
    const body=await response.json() as any;
    assert.equal(body.server.status,"ready");
    assert.equal(body.ollama.status,"ready");
    assert.equal(body.ollama.modelId,"ollama:gemma2:latest");
    assert.equal(body.docker.status,"ready");
    assert.match(body.ollama.detail,/Nog geen modelantwoord getest/);
    assert.ok(!JSON.stringify(body).includes(demo.token));
    assert.equal(requests,1,"a status request must use only non-generating model discovery");
    names=["other-model:latest"];
    docker={status:"image-missing",detail:"Missing Docker image"};
    const missing=await (await check()).json() as any;
    assert.equal(missing.ollama.status,"model-missing");
    assert.equal(missing.docker.status,"image-missing");
    await new Promise<void>(resolve=>ollama.close(()=>resolve()));
    const unavailable=await (await check()).json() as any;
    assert.equal(unavailable.ollama.status,"unavailable");
    assert.equal(unavailable.server.status,"ready","the server remains connected even when Ollama stops");
  }finally{
    await demo.close();
    if(ollama.listening)await new Promise<void>(resolve=>ollama.close(()=>resolve()));
    rmSync(root,{force:true,recursive:true});
  }
});

import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:net";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {localDockerEnvironment} from "../packages/operations/src/docker-local-transport.ts";

test("remote Docker transport is refused rather than given project source",()=>{
  for(const host of ["tcp://127.0.0.1:2375","tcp://docker.example:2376",
    "ssh://user@host","http://localhost:2375","unix:///path-that-does-not-exist/docker.sock"]){
    assert.throws(()=>localDockerEnvironment({DOCKER_HOST:host,PATH:"/usr/bin",HOME:"/tmp"}),/lokale Unix-socket/);
  }
});
test("Docker child inherits only a verified local Unix socket, never a remote context",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"eai-docker-socket-"));
  const socket=join(dir,"docker.sock");
  const fake=createServer();
  try{
    await new Promise<void>((resolve,reject)=>{
      fake.once("error",reject);fake.listen(socket,resolve);
    });
    const env=localDockerEnvironment({
      PATH:"/usr/bin",HOME:dir,DOCKER_HOST:"unix://"+socket,
      DOCKER_CONTEXT:"production-remote",DOCKER_CONFIG:"/home/example/remote"
    });
    assert.equal(env.DOCKER_HOST,"unix://"+socket);
    assert.equal("DOCKER_CONTEXT" in env,false);
    assert.equal("DOCKER_CONFIG" in env,false);
  }finally{
    await new Promise<void>(resolve=>fake.close(()=>resolve()));
    rmSync(dir,{recursive:true,force:true});
  }
});

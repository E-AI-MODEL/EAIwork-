import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {AddressInfo} from "node:net";
import {LocalCodeWorkspace} from "../packages/operations/src/code-worker.ts";
import {createDemoServer} from "../scripts/local-demo.ts";
import {canManageCode,validatePrincipals} from "../packages/server/src/authz.ts";

test("audit-only and executor tokens cannot read or authorize code changes",async()=>{
  const root=mkdtempSync(join(tmpdir(),"eai-code-permissions-"));
  const work=join(root,"project"),profile=join(root,"profile");
  mkdirSync(join(work,"src"),{recursive:true});
  mkdirSync(join(work,"tests"),{recursive:true});
  mkdirSync(profile);
  for(const name of ["a","b"]){
    writeFileSync(join(work,"src",name+".js"),"export const value=1;\n");
    writeFileSync(join(work,"tests",name+".test.js"),"import {test} from 'node:test';test('ok',()=>{});\n");
  }
  const workspace=new LocalCodeWorkspace({workspaceDir:work,profileDir:profile,
    host:"http://127.0.0.1:11434",model:"not-invoked"});
  const app=createDemoServer({persistentDir:profile,codeWorkspace:workspace,
    schedulerIntervalMs:0,seedDemoData:false,localLiveView:true});
  try{
    await new Promise<void>(resolve=>app.server.listen(0,"127.0.0.1",resolve));
    const url="http://127.0.0.1:"+((app.server.address() as AddressInfo).port);
    for(const token of [app.reviewerToken,app.workerToken]){
      for(const method of ["GET","POST"]){
        const response=await fetch(url+"/ops/code/plans",{
          method,headers:{Authorization:"Bearer "+token},
          ...(method==="POST"?{body:JSON.stringify({title:"Unauthorized",steps:[]})}:{})
        });
        assert.equal(response.status,403);
      }
    }
    const owner=await fetch(url+"/ops/code/plans",{headers:{Authorization:"Bearer "+app.token}});
    assert.equal(owner.status,200);
  }finally{
    await app.close();
    rmSync(root,{recursive:true,force:true});
  }
});

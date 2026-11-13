import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {proposeComposedWorker} from "../packages/operations/src/builder.ts";
import {applyOps,emptyOps} from "../packages/operations/src/registry.ts";
import {evaluateBuiltin,runMissionUntilBlocked} from "../packages/operations/src/execution.ts";
import {OpsStore} from "../packages/operations/src/store.ts";

test("Worker Builder produces only a reviewable, non-executing contract",()=>{
  const proposal=proposeComposedWorker("text-reviewer","Tekstcontrole");
  assert.equal(proposal.status,"contract-proposal-only");
  assert.deepEqual(proposal.components,["text-normalize","text-metrics"]);
  assert.deepEqual(proposal.contract.requestedPermissions,[]);
  assert.deepEqual(proposal.contract.tools,[]);
  assert.equal(proposal.contract.testSuite,"builtin-compose-fixture-v1");
  assert.equal(proposal.contract.recipe?.kind,"builtin-compose");
  assert.throws(()=>proposeComposedWorker("../escaped","Unsafe"),/invalid worker id/);
  assert.throws(()=>proposeComposedWorker("text-reviewer"," "),/invalid worker name/);
  const bad={...proposal.contract,recipe:{kind:"builtin-compose" as const,steps:["text-metrics","text-normalize"] as any}};
  assert.throws(()=>applyOps(emptyOps(),{id:"e1",at:"2026-11-10",actor:{kind:"person",id:"p"},event:{type:"worker.register",contract:bad}}),/invalid safe worker recipe/);
});
test("registered composed worker runs two real primitives with no external permission",()=>{
  const dir=mkdtempSync(join(tmpdir(),"eai-compose-"));
  let store=new OpsStore(dir);
  try{
    const contract=proposeComposedWorker("text-inspector","Tekstinspectie").contract;
    const emit=(event:any,kind:"person"|"check"="person")=>store.append({
      id:"comp-"+randomUUID(),at:"2026-11-10T00:00:00Z",
      actor:{kind,id:kind==="person"?"owner":"check:builtins"},event
    });
    emit({type:"worker.register",contract});
    const testRun=evaluateBuiltin(contract.id,contract);
    assert.equal(testRun.numerator,3);
    assert.equal(testRun.denominator,3);
    const evidenceRef="test:compose-v1";
    emit({type:"quality.record",measurement:{
      id:"measure-composed",workerId:contract.id,version:contract.version,
      taskKind:"text-inspect",dataset:testRun.dataset,suiteVersion:testRun.suiteVersion,
      cohort:testRun.cohort,metric:testRun.metric,numerator:testRun.numerator,denominator:testRun.denominator,
      measuredAt:"2026-11-10T00:00:00Z",evidenceRef,
    }},"check");
    emit({type:"worker.release",id:contract.id,evidenceRef});
    emit({type:"mission.create",plan:{
      id:"mission-compose",title:"Echte samengestelde uitvoering",goal:"Normaliseer en tel",
      tasks:[{id:"task-compose",title:"Tekst inspecteren",taskKind:"text-inspect",dependsOn:[],input:{text:"  Hallo   wereld\r\nNu "}}],
    }});
    const r=runMissionUntilBlocked(store,"mission-compose");
    assert.equal(r.stopReason,"complete");
    const out=store.snapshot().missions["mission-compose"].tasks["task-compose"].run!.output!;
    assert.equal(out.text,"Hallo wereld\nNu");
    assert.equal(out.words,3);
    assert.equal(out.changed,true);
    store.close();store=new OpsStore(dir);
    assert.equal(store.snapshot().missions["mission-compose"].tasks["task-compose"].status,"done");
  }finally{store.close();rmSync(dir,{recursive:true,force:true})}
});

import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir,hostname} from "node:os";
import {join} from "node:path";
import {OpsStore} from "../packages/operations/src/store.ts";

const contract={
  id:"durability-reviewer",version:"1.0.0",name:"Durability reviewer",
  specialization:"Fixed test contract",taskKinds:["text-review"],
  inputSchema:{type:"object"},outputSchema:{type:"object"},
  tools:[],requestedPermissions:[],modelPolicy:{preferred:"deterministic" as const},
  testSuite:"fixtures",stopConditions:["invalid-input"],
};
const envelope=(id:string)=>({
  id,at:"2026-11-10T09:00:00Z",
  actor:{kind:"person" as const,id:"person:durability-test"},
  event:{type:"worker.register" as const,contract:{...contract,id}},
});
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),"eai-durable-ops-"));
  const path=(file:string)=>join(dir,file);
  const cleanup=()=>rmSync(dir,{recursive:true,force:true});
  return {dir,path,cleanup};
}
test("acknowledged events survive reopening, with no recovery on a clean journal",()=>{
  const f=fixture();
  try{
    let store=new OpsStore(f.dir);
    store.append(envelope("worker-one"));
    assert.equal(store.verify().ok,true);
    store.close();
    store=new OpsStore(f.dir);
    assert.equal(store.recoveredTail,0);
    assert.ok(store.snapshot().workers["worker-one"]);
    store.append(envelope("worker-two"));
    assert.equal(store.verify().entries,2);
    store.close();
  }finally{f.cleanup()}
});
test("a complete, valid single-event crash tail is replayed exactly once",()=>{
  const f=fixture();
  try{
    let store=new OpsStore(f.dir);
    store.append(envelope("worker-one"));
    const committed=readFileSync(f.path("worker-events.head"),"utf8");
    store.append(envelope("worker-two"));
    store.close();
    // Simulate a crash after the second journal fsync and before head rename.
    writeFileSync(f.path("worker-events.head"),committed);
    store=new OpsStore(f.dir);
    assert.equal(store.recoveredTail,1);
    assert.ok(store.snapshot().workers["worker-two"]);
    assert.equal(store.verify().ok,true);
    assert.equal(store.verify().entries,2);
    store.close();
    store=new OpsStore(f.dir);
    assert.equal(store.recoveredTail,0);
    assert.equal(store.verify().entries,2);
    store.close();
  }finally{f.cleanup()}
});
test("two uncommitted entries are not silently reconciled",()=>{
  const f=fixture();
  try{
    let store=new OpsStore(f.dir);
    store.append(envelope("worker-one"));
    const first=readFileSync(f.path("worker-events.head"),"utf8");
    store.append(envelope("worker-two"));
    store.append(envelope("worker-three"));
    store.close();
    writeFileSync(f.path("worker-events.head"),first);
    assert.throws(()=>new OpsStore(f.dir),/manual review required/);
  }finally{f.cleanup()}
});
test("incomplete tail, modified payload and missing head fail closed",()=>{
  const tamper=[
    (f:ReturnType<typeof fixture>)=>{
      const file=f.path("worker-events.jsonl");
      writeFileSync(file,readFileSync(file,"utf8").trimEnd());
    },
    (f:ReturnType<typeof fixture>)=>{
      const file=f.path("worker-events.jsonl");
      writeFileSync(file,readFileSync(file,"utf8").replace("Durability reviewer","Modified reviewer"));
    },
    (f:ReturnType<typeof fixture>)=>{
      rmSync(f.path("worker-events.head"));
    },
  ];
  for(const change of tamper){
    const f=fixture();
    try{
      const store=new OpsStore(f.dir);
      store.append(envelope("worker-one"));
      store.close();
      change(f);
      assert.throws(()=>new OpsStore(f.dir),/integrity check/);
    }finally{f.cleanup()}
  }
});
test("a live writer blocks another; a confirmed dead local owner can be reclaimed",()=>{
  const f=fixture();
  try{
    const store=new OpsStore(f.dir);
    assert.throws(()=>new OpsStore(f.dir),/already active/);
    store.close();
    writeFileSync(f.path(".operations-writer.lock"),
      JSON.stringify({pid:99999999,host:hostname()})+"\n");
    const reopened=new OpsStore(f.dir);
    reopened.append(envelope("worker-one"));
    assert.equal(reopened.verify().ok,true);
    reopened.close();
  }finally{f.cleanup()}
});
test("tampering while a store is open blocks further writes and reads",()=>{
  const f=fixture();
  try{
    const store=new OpsStore(f.dir);
    store.append(envelope("worker-one"));
    const file=f.path("worker-events.jsonl");
    writeFileSync(file,readFileSync(file,"utf8")+"garbage\n");
    assert.throws(()=>store.snapshot(),/changed outside writer/);
    assert.throws(()=>store.append(envelope("worker-two")) ,/changed outside writer/);
    assert.equal(store.verify().ok,false);
    store.close();
  }finally{f.cleanup()}
});

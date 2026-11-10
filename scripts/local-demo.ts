/**
 * Local-only EAIwork demonstration. No persistent credentials or third-party services.
 * Each invocation creates a fresh temporary operations and evidence journal.
 */
import {generateKeyPairSync,randomBytes,randomUUID} from "node:crypto";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {makeServer} from "../packages/server/src/server.ts";
import {SignedFileAnchorWitness} from "../packages/server/src/witness.ts";
import {evaluateBuiltin,runMissionUntilBlocked} from "../packages/operations/src/execution.ts";
import {proposeComposedWorker} from "../packages/operations/src/builder.ts";
import type {WorkerContract,OpsEvent,OpsActor} from "../packages/operations/src/registry.ts";
import type {PlanningModel} from "../packages/operations/src/planner.ts";

const person:OpsActor={kind:"person",id:"person:demo"};
const check:OpsActor={kind:"check",id:"check:builtins"};
const simple=(id:string,taskKind:string,testSuite="builtin-fixture-v1"):WorkerContract=>({
  id,version:"1.0.0",name:id,specialization:"Fixed local demonstration",
  taskKinds:[taskKind],inputSchema:{type:"object",properties:{text:{type:"string"}},required:["text"]},
  outputSchema:{type:"object"},
  tools:id==="repo-search"?["repo.search"]:[],
  requestedPermissions:id==="repo-search"?["read:repo"]:[],
  modelPolicy:{preferred:"deterministic"},testSuite,stopConditions:["invalid-input"],
});

export function createDemoServer(options:{schedulerIntervalMs?:number;planningModel?:PlanningModel}={}){
  const root=mkdtempSync(join(tmpdir(),"eaiwork-dashboard-demo-"));
  const witnessDir=mkdtempSync(join(tmpdir(),"eaiwork-demo-witness-"));
  const pair=generateKeyPairSync("ed25519");
  const witness=new SignedFileAnchorWitness(
    witnessDir,
    pair.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    pair.publicKey.export({format:"pem",type:"spki"}).toString(),
  );
  const token=randomBytes(32).toString("hex");
  const workerToken=randomBytes(32).toString("hex");
  const pack=JSON.parse(readFileSync(new URL("../packs/sow-demo/pack.json",import.meta.url),"utf8"));
  const {server,operations,scheduler}=makeServer({
    dir:join(root,"evidence"),operationsDir:join(root,"operations"),
    pack,witness,repoSearchRoot:resolve("."),schedulerIntervalMs:options.schedulerIntervalMs,
    planningModel:options.planningModel,
    tokens:{[token]:{actor:person,access:{read:"*",write:[],audit:true}}},
    executorTokens:{[workerToken]:{ownerId:"executor-local-demo",
      taskKinds:["text-normalize","text-metrics"]}},
  });
  if(!operations)throw new Error("demonstration operations journal missing");
  const emit=(event:OpsEvent,actor:OpsActor=person)=>operations.append({
    id:"ops-"+randomUUID(),at:new Date().toISOString(),actor,event,
  });
  for(const contract of [
    simple("text-normalize","text-normalize"),
    simple("text-metrics","text-metrics"),
    simple("repo-search","repo-search","repo-search-fixture-v1"),
    proposeComposedWorker("text-inspector","Tekstinspectie").contract,
  ]){
    emit({type:"worker.register",contract});
    const result=evaluateBuiltin(contract.id,contract);
    if(result.numerator!==result.denominator)throw new Error("built-in demonstration test failed");
    const evidenceRef="demo-fixtures:"+randomUUID();
    emit({type:"quality.record",measurement:{
      id:"measurement-"+randomUUID(),workerId:contract.id,version:contract.version,
      taskKind:result.taskKind,dataset:result.dataset,suiteVersion:result.suiteVersion,
      cohort:result.cohort,metric:result.metric,numerator:result.numerator,
      denominator:result.denominator,measuredAt:new Date().toISOString(),evidenceRef,
    }},check);
    emit({type:"worker.release",id:contract.id,evidenceRef});
  }
  const mission={
    id:"mission-demo-text",title:"Tekstproef met echte workers",
    goal:"Normaliseer tekst en geef het resultaat door aan de teller",
    tasks:[
      {id:"task-clean",title:"Tekst opschonen",taskKind:"text-normalize",
        dependsOn:[],input:{text:"  Hallo  EAIwork\r\nWerkt dit?  "}},
      {id:"task-count",title:"Woorden tellen",taskKind:"text-metrics",
        dependsOn:["task-clean"],textFrom:"task-clean"},
    ],
  };
  emit({type:"mission.create",plan:mission});
  const outcome=runMissionUntilBlocked(operations,mission.id);
  if(outcome.stopReason!=="complete")throw new Error("demo mission did not finish");
  emit({type:"mission.create",plan:{
    id:"mission-demo-repo",title:"Zoek in de eigen repository",
    goal:"Vind een codepassage met regelnummer en bestands-hash",
    tasks:[{id:"task-search",title:"Zoek workerisolatie",taskKind:"repo-search",
      dependsOn:[],input:{text:"AtomCapsule"}}],
  }});
  emit({type:"mission.create",plan:{
    id:"mission-demo-compose",title:"Samengestelde worker uitvoeren",
    goal:"Bewerk en tel tekst met een opgebouwde worker",
    tasks:[{id:"task-inspect",title:"Tekstinspectie",taskKind:"text-inspect",
      dependsOn:[],input:{text:"  EAIwork  kan  combineren  "}}],
  }});
  emit({type:"mission.create",plan:{
    id:"mission-demo-automatic",title:"Automatische tekstverwerking uitproberen",
    goal:"Laat de server met een taakmaximum twee afhankelijke lokale stappen uitvoeren",
    tasks:[
      {id:"task-clean-auto",title:"Tekst normaliseren",taskKind:"text-normalize",
        dependsOn:[],input:{text:"  EAIwork  voert  taken  uit  "}},
      {id:"task-count-auto",title:"Woorden tellen",taskKind:"text-metrics",
        dependsOn:["task-clean-auto"],textFrom:"task-clean-auto"},
    ],
  }});
  async function close(){
    if(server.listening)await new Promise<void>(done=>server.close(()=>done()));
    rmSync(root,{recursive:true,force:true});
    rmSync(witnessDir,{recursive:true,force:true});
  }
  return {server,token,workerToken,scheduler,close};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const demo=createDemoServer();
  const port=Number(process.env.EAI_DEMO_PORT||8788);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error("invalid local demo port");
  demo.server.listen(port,"127.0.0.1",()=>{
    process.stdout.write("\nEAIwork lokale proef (alleen deze computer)\n"+
      "Dashboard: http://127.0.0.1:"+port+"/dashboard\n"+
      "Toegangstoken: "+demo.token+"\n"+
      "Losse tekstworker (alleen lokale proef): EAI_EXECUTOR_TOKEN="+demo.workerToken+"\n"+
      "Start apart: EAI_EXECUTOR_URL=http://127.0.0.1:"+port+
        " EAI_EXECUTOR_TOKEN=<token> node scripts/local-text-executor.ts\n"+
      "Open Contracten en registratie en verbind met dit tijdelijke token.\n"+
      "Er zijn vier opdrachten en vier geteste lokale workers.\n"+
      "Stop met Ctrl+C. Tijdelijke gegevens worden verwijderd.\n\n");
  });
  let closing=false;
  const stop=async()=>{
    if(closing)return;closing=true;
    await demo.close();
    process.exit(0);
  };
  process.on("SIGINT",()=>{void stop()});
  process.on("SIGTERM",()=>{void stop()});
}

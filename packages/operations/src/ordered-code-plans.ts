/** Ordered, human-reviewed JavaScript changes within one operator-selected worktree.
 * Plans are durable. A failed or unverified step never advances the next step.
 */
import {createHash,randomUUID} from "node:crypto";
import {chmodSync,closeSync,existsSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,renameSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import type {LocalCodeWorkspace} from "./code-worker.ts";
import type {DockerTestResult} from "./docker-code-test.ts";
import {runIsolatedProjectSuite,projectManifestSha256,type ProjectTestInput,type ProjectTestResult} from "./docker-project-suite.ts";

type StepInput={path:string;instruction:string;testPath:string};
type PlannedStep=StepInput & {
  sourceSha256:string;testSha256:string;proposalId?:string;
  postTest?:DockerTestResult;
  projectPreTest?:ProjectTestResult;projectPostTest?:ProjectTestResult;
};
type PlanRecord={
  id:string;title:string;createdAt:string;createdBy:string;
  steps:PlannedStep[];suitePolicy?:"single-file-v1"|"project-node-v1";
  stoppedAt?:string;stoppedBy?:string;
};
const sha=(input:string)=>createHash("sha256").update(input).digest("hex");
const uuid=/^[0-9a-f-]{36}$/;
const atomic=(path:string,data:PlanRecord)=>{
  const temporary=path+"."+randomUUID()+".tmp";
  const fd=openSync(temporary,"wx",0o600);
  try{writePlan(fd,data);fsyncSync(fd)}finally{closeSync(fd)}
  renameSync(temporary,path);
};
const writePlan=(fd:number,data:PlanRecord)=>{
  const {digest,...body}=data as PlanRecord & {digest?:string};
  const payload=JSON.stringify(body);
  const record={...body,digest:sha(payload)};
  // A digest catches accidental corruption, not an attacker who can rewrite this directory.
  writeFileSync(fd,JSON.stringify(record)+"\n");
};

export class OrderedCodePlans {
  private readonly folder:string;
  private busy=false;
  private readonly workspace:LocalCodeWorkspace;
  private readonly suiteRunner:(input:ProjectTestInput)=>Promise<ProjectTestResult>;
  constructor(workspace:LocalCodeWorkspace,config:{suiteRunner?:(input:ProjectTestInput)=>Promise<ProjectTestResult>}={}){
    this.suiteRunner=config.suiteRunner??runIsolatedProjectSuite;
    this.workspace=workspace;
    this.folder=workspace.planDir;
    if(existsSync(this.folder)){
      const stat=lstatSync(this.folder);
      if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error("Planmap is onveilig");
    }else mkdirSync(this.folder,{mode:0o700});
    if(process.platform!=="win32")chmodSync(this.folder,0o700);
  }
  private filename(id:string){
    if(!uuid.test(id))throw new Error("Ongeldig plannummer");
    return join(this.folder,id+".json");
  }
  private load(id:string):PlanRecord{
    const filename=this.filename(id);
    const st=lstatSync(filename);
    if(!st.isFile()||st.isSymbolicLink()||st.size>100000)throw new Error("Planbestand is ongeldig");
    const parsed=JSON.parse(readFileSync(filename,"utf8"));
    const {digest,...record}=parsed;
    if(typeof digest!=="string"||digest!==sha(JSON.stringify(record))||
       record.id!==id||!Array.isArray(record.steps)||record.steps.length<2||record.steps.length>8)
      throw new Error("Planbestand is veranderd");
    return record as PlanRecord;
  }
  private save(record:PlanRecord){atomic(this.filename(record.id),record)}
  list(){
    return readdirSync(this.folder).filter(f=>uuid.test(f.slice(0,-5))&&f.endsWith(".json"))
      .map(f=>this.view(f.slice(0,-5)))
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,30);
  }
  view(id:string){
    const plan=this.load(id);
    let released=true;
    const suiteRequired=plan.suitePolicy==="project-node-v1";
    const steps=plan.steps.map((step,index)=>{
      let status:"waiting"|"review"|"needs-post-test"|"needs-project-test"|"done"|"blocked"="waiting";
      let detail="";
      let proposal:null|ReturnType<LocalCodeWorkspace["inspect"]>=null;
      try{
        const testUnchanged=this.workspace.fileSha256(step.testPath)===step.testSha256;
        if(!testUnchanged){status="blocked";detail="Testbestand is sinds het plan gewijzigd"}
        else if(step.proposalId){
          proposal=this.workspace.inspect(step.proposalId);
          if(proposal.path!==step.path||proposal.sourceSha256!==step.sourceSha256||
             proposal.testPath!==step.testPath){status="blocked";detail="Voorstel hoort niet bij deze stap"}
          else if(proposal.status==="restored"){status="blocked";detail="Eerder toegepaste code is hersteld"}
          else if(proposal.status==="applied"){
            if(suiteRequired){
              if(proposal.sourceChanged){status="blocked";detail="Toegepaste bron is gewijzigd"}
              else if(step.projectPostTest?.status==="passed"&&step.projectPostTest.testsExecuted)
                status="done";
              else if(step.projectPostTest){status="blocked";detail="Gezamenlijke projecttest is niet geslaagd"}
              else status="needs-project-test";
            }else if(!proposal.sourceChanged&&step.postTest?.status==="passed"&&step.postTest.testsExecuted&&
                     step.postTest.candidateSha256===proposal.replacementSha256&&
                     step.postTest.testSha256===step.testSha256)status="done";
            else if(!proposal.sourceChanged&&!step.postTest)status="needs-post-test";
            else {status="blocked";detail="Test mislukt of toegepaste bron is veranderd"}
          }else if(proposal.status==="requires-human-review"&&proposal.sourceUnchanged){
            if(suiteRequired&&step.projectPreTest&&
               (step.projectPreTest.status!=="passed"||!step.projectPreTest.testsExecuted)){
              status="blocked";detail="Gezamenlijke test vóór toepassen is niet geslaagd";
            }else status="review";
          }else{status="blocked";detail="Bronbestand of voorstel is veranderd"}
        }else if(this.workspace.fileSha256(step.path)!==step.sourceSha256){
          status="blocked";detail="Bronbestand is na het vastleggen van het plan veranderd";
        }
      }catch{status="blocked";detail="Bestand of voorstel kan niet veilig worden gecontroleerd"}
      if(released&&status==="done")released=true;
      else if(released){released=false}
      return {index,path:step.path,testPath:step.testPath,instruction:step.instruction,
        status,detail,proposalId:step.proposalId??null,
        replacementSha256:proposal?.replacementSha256??null,
        preflight:proposal?.preflight?.status??null,
        testStatus:proposal?.testReport?.status??null,
        postTestStatus:step.postTest?.status??null,
        projectPreStatus:step.projectPreTest?.status??null,
        projectPostStatus:step.projectPostTest?.status??null,
        active:false};
    });
    const next=steps.findIndex(s=>s.status!=="done");
    const invalidOrder=steps.some((s,i)=>i>next&&next>=0&&s.status!=="waiting");
    const blocked=invalidOrder||steps.some(s=>s.status==="blocked")||
      (!!plan.stoppedAt);
    const state=plan.stoppedAt?"stopped":blocked?"blocked":next<0?"done":"active";
    if(state==="active"&&next>=0)steps[next].active=true;
    return {id:plan.id,title:plan.title,createdAt:plan.createdAt,
      createdBy:plan.createdBy,stoppedAt:plan.stoppedAt??null,
      state,nextStep:state==="active"?next:null,
      suitePolicy:plan.suitePolicy??"single-file-v1",steps};
  }
  create(input:{title:string;steps:StepInput[];suitePolicy?:"single-file-v1"|"project-node-v1"},actorId:string){
    if(this.busy)throw new Error("Er loopt al een codeactie");
    if(!actorId.startsWith("person:"))throw new Error("Een persoon moet het plan vastleggen");
    if(typeof input?.title!=="string"||!input.title.trim()||input.title.length>120||
       !Array.isArray(input.steps)||input.steps.length<2||input.steps.length>8)
      throw new Error("Gebruik een titel en twee tot acht bestandsstappen");
    if(this.list().some(p=>p.state==="active"||p.state==="blocked"))
      throw new Error("Rond het bestaande codeplan af of stop het eerst");
    if(input.suitePolicy!==undefined&&
       !["single-file-v1","project-node-v1"].includes(input.suitePolicy))
      throw new Error("Onbekende testmethode voor het codeplan");
    const paths=new Set<string>();
    const tests=new Set<string>();
    for(const step of input.steps){
      if(!step||typeof step.path!=="string"||!step.path.endsWith(".js")||
         typeof step.testPath!=="string"||!step.testPath.endsWith(".test.js")||
         typeof step.instruction!=="string"||!step.instruction.trim()||
         step.instruction.length>3000||step.path===step.testPath||
         paths.has(step.path)||tests.has(step.testPath))
        throw new Error("Elke stap vereist een uniek .js-bestand, een .test.js-bestand en een opdracht");
      paths.add(step.path);tests.add(step.testPath);
    }
    if(input.steps.some(step=>paths.has(step.testPath)))
      throw new Error("Testbestanden mogen niet tegelijk gewijzigde bronbestanden zijn");
    const steps=input.steps.map(step=>({
      path:step.path,instruction:step.instruction,testPath:step.testPath,
      sourceSha256:this.workspace.fileSha256(step.path),
      testSha256:this.workspace.fileSha256(step.testPath)
    }));
    const record:PlanRecord={id:randomUUID(),title:input.title.trim(),
      createdAt:new Date().toISOString(),createdBy:actorId,steps,
      suitePolicy:input.suitePolicy??"single-file-v1"};
    this.save(record);
    return this.view(record.id);
  }
  active(id:string){
    const view=this.view(id);
    if(view.state!=="active"||view.nextStep===null)
      throw new Error("Dit codeplan is afgerond of geblokkeerd");
    const record=this.load(id);
    return {record,index:view.nextStep,step:record.steps[view.nextStep],
      status:view.steps[view.nextStep].status};
  }
  attachProposal(id:string,proposalId:string){
    const {record,index,step,status}=this.active(id);
    if(status!=="waiting"||step.proposalId)
      throw new Error("De volgende stap heeft al een voorstel");
    const inspected=this.workspace.inspect(proposalId);
    if(inspected.path!==step.path||inspected.sourceSha256!==step.sourceSha256||
       inspected.testPath!==step.testPath)
      throw new Error("Voorstel hoort niet bij de geplande bronversie");
    record.steps[index]={...step,proposalId};
    this.save(record);
    return this.view(id);
  }
  assertProposal(id:string,proposalId:string,expected:"review"|"needs-post-test"){
    const current=this.active(id);
    if(current.status!==expected||current.step.proposalId!==proposalId)
      throw new Error("Deze stap is niet aan de beurt of heeft een andere voorstelversie");
    return current;
  }
  belongs(proposalId:string){
    for(const name of readdirSync(this.folder).filter(f=>f.endsWith(".json")&&uuid.test(f.slice(0,-5)))){
      const record=this.load(name.slice(0,-5));
      if(record.steps.some(step=>step.proposalId===proposalId))return record.id;
    }
    return null;
  }
  storePostTest(id:string,proposalId:string,result:DockerTestResult){
    const {record,index,step}=this.assertProposal(id,proposalId,"needs-post-test");
    const checked=this.workspace.inspect(proposalId);
    if(checked.status!=="applied"||checked.sourceChanged||
       result.candidateSha256!==checked.replacementSha256||
       result.testSha256!==step.testSha256)
      throw new Error("Testuitslag hoort niet bij de daadwerkelijk toegepaste bron");
    record.steps[index]={...step,postTest:result};
    this.save(record);
    return this.view(id);
  }
  private projectInput(record:PlanRecord,index:number,proposalId:string,phase:"pre"|"post"):ProjectTestInput{
    const selected=record.steps[index];
    const proposal=this.workspace.inspect(proposalId);
    if(selected.proposalId!==proposalId||proposal.path!==selected.path||
       proposal.sourceSha256!==selected.sourceSha256||
       proposal.testPath!==selected.testPath)
      throw new Error("Projecttest verwijst niet naar dezelfde voorstelversie");
    const files:ProjectTestInput["files"]=[];
    const testPaths:string[]=[];
    for(let i=0;i<record.steps.length;i++){
      const step=record.steps[i];
      const actual=this.workspace.readApprovedFile(step.path);
      const test=this.workspace.readApprovedFile(step.testPath);
      if(sha(test)!==step.testSha256)
        throw new Error("Testbestand is gewijzigd; projecttest geweigerd");
      let expected=step.sourceSha256;
      if(i<index){
        if(!step.proposalId)throw new Error("Een eerdere wijziging heeft geen voorstel");
        const prior=this.workspace.inspect(step.proposalId);
        if(prior.status!=="applied"||step.projectPostTest?.status!=="passed"||!step.projectPostTest.testsExecuted)
          throw new Error("Een eerdere bestandsstap is niet volledig goedgekeurd");
        expected=prior.replacementSha256;
      }else if(i===index&&phase==="post"){
        if(proposal.status!=="applied")throw new Error("Code is nog niet toegepast");
        expected=proposal.replacementSha256;
      }
      if(sha(actual)!==expected)
        throw new Error("Een gepland bronbestand is gewijzigd; projecttest geweigerd");
      files.push({path:step.path,content:i===index&&phase==="pre"?proposal.replacement:actual});
      files.push({path:step.testPath,content:test});
      testPaths.push(step.testPath);
    }
    return {files,testPaths};
  }
  projectPreApproved(id:string,proposalId:string){
    const {record,index,step,status}=this.active(id);
    if(record.suitePolicy!=="project-node-v1")return true;
    if(status!=="review"||step.proposalId!==proposalId||
       step.projectPreTest?.status!=="passed"||!step.projectPreTest.testsExecuted)
      return false;
    const manifest=projectManifestSha256(this.projectInput(record,index,proposalId,"pre"));
    return step.projectPreTest.manifestSha256===manifest;
  }
  async runProjectSuite(id:string,proposalId:string,phase:"pre"|"post",onResult?:(result:ProjectTestResult)=>void){
    const current=this.active(id);
    const {record,index,step,status}=current;
    if(record.suitePolicy!=="project-node-v1")
      throw new Error("Dit codeplan gebruikt geen gezamenlijke projecttests");
    if(step.proposalId!==proposalId||
       status!==(phase==="pre"?"review":"needs-project-test"))
      throw new Error("De test hoort niet bij de huidige bestandsstap");
    const inspected=this.workspace.inspect(proposalId);
    if(phase==="pre"&&(!inspected.sourceUnchanged||!inspected.replacementHashMatches||
       inspected.preflight.status==="failed"))
      throw new Error("Controleer eerst de voorgestelde code");
    if(phase==="post"&&(inspected.status!=="applied"||inspected.sourceChanged))
      throw new Error("De toegepaste code is gewijzigd of ontbreekt");
    const input=this.projectInput(record,index,proposalId,phase);
    const manifest=projectManifestSha256(input);
    const result=await this.suiteRunner(input);
    const latest=this.active(id);
    if(latest.index!==index||latest.step.proposalId!==proposalId||
       latest.status!==status||
       projectManifestSha256(this.projectInput(latest.record,index,proposalId,phase))!==manifest)
      throw new Error("De projectbestanden zijn tijdens de test veranderd");
    if(result.runner!=="docker-project-node-v1"||
       result.manifestSha256!==manifest||
       result.fileCount!==input.files.length||
       JSON.stringify(result.testPaths)!==JSON.stringify([...input.testPaths].sort())||
       !["passed","failed","unavailable"].includes(result.status)||
       (result.status==="passed"&&!result.testsExecuted))
      throw new Error("De gezamenlijke testuitslag hoort niet bij deze bronversies");
    // Write the measured outcome to the operations journal before advancing the plan.
    onResult?.(result);
    latest.record.steps[index]={...latest.step,
      ...(phase==="pre"?{projectPreTest:result}:{projectPostTest:result})};
    this.save(latest.record);
    return {result,plan:this.view(id)};
  }
  stop(id:string,actorId:string){
    if(this.busy)throw new Error("Er loopt een codeactie");
    if(!actorId.startsWith("person:"))throw new Error("Alleen een persoon kan een plan stoppen");
    const record=this.load(id);
    if(this.view(id).state==="done")throw new Error("Plan is al afgerond");
    if(!record.stoppedAt){
      record.stoppedAt=new Date().toISOString();record.stoppedBy=actorId;
      this.save(record);
    }
    return this.view(id);
  }
  async exclusive<T>(run:()=>Promise<T>):Promise<T>{
    if(this.busy)throw new Error("Een andere codeactie is nog bezig");
    this.busy=true;
    try{return await run()}finally{this.busy=false}
  }
}

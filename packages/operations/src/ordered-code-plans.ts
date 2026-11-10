/** Ordered, human-reviewed JavaScript changes within one operator-selected worktree.
 * Plans are durable. A failed or unverified step never advances the next step.
 */
import {createHash,randomUUID} from "node:crypto";
import {chmodSync,closeSync,existsSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,renameSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import type {LocalCodeWorkspace} from "./code-worker.ts";
import type {DockerTestResult} from "./docker-code-test.ts";

type StepInput={path:string;instruction:string;testPath:string};
type PlannedStep=StepInput & {
  sourceSha256:string;testSha256:string;proposalId?:string;
  postTest?:DockerTestResult;
};
type PlanRecord={
  id:string;title:string;createdAt:string;createdBy:string;
  steps:PlannedStep[];stoppedAt?:string;stoppedBy?:string;
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
  constructor(workspace:LocalCodeWorkspace){
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
    const steps=plan.steps.map((step,index)=>{
      let status:"waiting"|"review"|"needs-post-test"|"done"|"blocked"="waiting";
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
            if(!proposal.sourceChanged&&step.postTest?.status==="passed"&&step.postTest.testsExecuted&&
               step.postTest.candidateSha256===proposal.replacementSha256&&
               step.postTest.testSha256===step.testSha256)status="done";
            else if(!proposal.sourceChanged&&!step.postTest)status="needs-post-test";
            else {status="blocked";detail="Test mislukt of toegepaste bron is veranderd"}
          }else if(proposal.status==="requires-human-review"&&proposal.sourceUnchanged){
            status="review";
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
      state,nextStep:state==="active"?next:null,steps};
  }
  create(input:{title:string;steps:StepInput[]},actorId:string){
    if(this.busy)throw new Error("Er loopt al een codeactie");
    if(!actorId.startsWith("person:"))throw new Error("Een persoon moet het plan vastleggen");
    if(typeof input?.title!=="string"||!input.title.trim()||input.title.length>120||
       !Array.isArray(input.steps)||input.steps.length<2||input.steps.length>8)
      throw new Error("Gebruik een titel en twee tot acht bestandsstappen");
    if(this.list().some(p=>p.state==="active"||p.state==="blocked"))
      throw new Error("Rond het bestaande codeplan af of stop het eerst");
    const paths=new Set<string>();
    for(const step of input.steps){
      if(!step||typeof step.path!=="string"||!step.path.endsWith(".js")||
         typeof step.testPath!=="string"||!step.testPath.endsWith(".test.js")||
         typeof step.instruction!=="string"||!step.instruction.trim()||
         step.instruction.length>3000||step.path===step.testPath||paths.has(step.path))
        throw new Error("Elke stap vereist een uniek .js-bestand, een .test.js-bestand en een opdracht");
      paths.add(step.path);
    }
    if(input.steps.some(step=>paths.has(step.testPath)))
      throw new Error("Testbestanden mogen niet tegelijk gewijzigde bronbestanden zijn");
    const steps=input.steps.map(step=>({
      path:step.path,instruction:step.instruction,testPath:step.testPath,
      sourceSha256:this.workspace.fileSha256(step.path),
      testSha256:this.workspace.fileSha256(step.testPath)
    }));
    const record:PlanRecord={id:randomUUID(),title:input.title.trim(),
      createdAt:new Date().toISOString(),createdBy:actorId,steps};
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

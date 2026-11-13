/** Local Ollama code proposal. No model-initiated writes, commands or network egress. */
import {createHash,randomUUID} from "node:crypto";
import {chmodSync,closeSync,existsSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,renameSync,unlinkSync,writeFileSync} from "node:fs";
import {isAbsolute,join,relative,resolve,sep} from "node:path";
import {localOllamaHost,discoverLocalOllamaModels} from "../../gateway/src/ollama-provider.ts";
import {checkCodeSyntax,type CodePreflight} from "./code-preflight.ts";
import {compareSource} from "./code-diff.ts";
import {runIsolatedNodeTest,type DockerTestResult,type DockerTestInput} from "./docker-code-test.ts";
import {validSingleFilePass} from "./docker-test-outcome.ts";

type ProposalRecord={
  id:string;path:string;sourceSha256:string;replacementSha256:string;
  replacement:string;original?:string;explanation:string;checks:string[];
  createdAt:string;modelId:string;status:"requires-human-review"|"applied"|"restored";
  preflight?:CodePreflight;
  testPath?:string;testReport?:DockerTestResult;
  appliedAt?:string;appliedBy?:string;
  restoredAt?:string;restoredBy?:string;
};
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
const safeRoot=(path:string)=>{
  const root=resolve(path);
  const st=lstatSync(root);
  if(!st.isDirectory()||st.isSymbolicLink())throw new Error("Werkmap moet een echte lokale map zijn");
  return root;
};
const allowedFile=(name:string)=>{
  if(typeof name!=="string"||!name||name.length>240||isAbsolute(name)||name.includes("\\")||name.includes("\0"))
    throw new Error("Ongeldig relatief bestandspad");
  const parts=name.split("/");
  if(parts.some(p=>!p||p==="."||p===".."||p.startsWith(".")||
     !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(p)||
     ["node_modules","dist","build","vendor"].includes(p)))
    throw new Error("Niet-toegestaan bestandspad");
  if(!/\.(ts|tsx|js|jsx|json|css|html|md|py)$/.test(name))
    throw new Error("Bestandstype niet toegestaan");
  return parts;
};
const safeExistingFile=(root:string,path:string)=>{
  const parts=allowedFile(path);
  let current=root;
  for(let i=0;i<parts.length;i++){
    current=join(current,parts[i]);
    const info=lstatSync(current);
    if(info.isSymbolicLink())throw new Error("Symbolische links zijn niet toegestaan");
    if(i!==parts.length-1&&!info.isDirectory())
      throw new Error("Bestandspad heeft geen geldige map");
    if(i===parts.length-1&&!info.isFile())
      throw new Error("Alleen bestaande gewone bestanden zijn toegestaan");
  }
  const rel=relative(root,current);
  if(rel.startsWith("..")||isAbsolute(rel))throw new Error("Bestand staat buiten de werkmap");
  return current;
};
const readBounded=(file:string)=>{
  const info=lstatSync(file);
  if(!info.isFile()||info.isSymbolicLink()||info.size>32768)
    throw new Error("Codebestand is te groot of ongeldig");
  const content=readFileSync(file,"utf8");
  if(content.includes("\0")||Buffer.byteLength(content)>32768)
    throw new Error("Bestand heeft geen ondersteunde tekstinhoud");
  return content;
};
const boundedResponse=async(response:Response)=>{
  if(!response.ok)throw new Error("Ollama kon geen codevoorstel maken (HTTP "+response.status+")");
  if(Number(response.headers.get("content-length")||0)>100000)throw new Error("Modelantwoord is te groot");
  const reader=response.body?.getReader();
  if(!reader)throw new Error("Modelantwoord ontbreekt");
  let length=0;const chunks:Uint8Array[]=[];
  while(true){
    const item=await reader.read();
    if(item.done)break;
    length+=item.value.byteLength;
    if(length>100000){await reader.cancel();throw new Error("Modelantwoord is te groot")}
    chunks.push(item.value);
  }
  let envelope;
  try{envelope=JSON.parse(Buffer.concat(chunks).toString("utf8"))}
  catch{throw new Error("Ollama stuurde geen geldig antwoord")}
  if(typeof envelope?.message?.content!=="string")throw new Error("Ollama gaf geen code terug");
  let proposal;
  try{proposal=JSON.parse(envelope.message.content)}
  catch{throw new Error("Codevoorstel heeft geen geldig JSON-formaat")}
  if(!proposal||typeof proposal!=="object"||Array.isArray(proposal)||
     Object.keys(proposal).some(k=>!["replacement","explanation","checks"].includes(k))||
     typeof proposal.replacement!=="string"||!proposal.replacement.trim()||Buffer.byteLength(proposal.replacement)>32768||
     typeof proposal.explanation!=="string"||proposal.explanation.length>3000||
     !Array.isArray(proposal.checks)||proposal.checks.length>8||
     proposal.checks.some((c:unknown)=>typeof c!=="string"||c.length>200))
    throw new Error("Codevoorstel voldoet niet aan het contract");
  return proposal as {replacement:string;explanation:string;checks:string[]};
};
const saveJson=(path:string,data:unknown)=>{
  const file=path+"."+randomUUID()+".tmp";
  const fd=openSync(file,"wx",0o600);
  try{writeFileSync(fd,JSON.stringify(data)+"\n");fsyncSync(fd)}finally{closeSync(fd)}
  renameSync(file,path);
};

export class LocalCodeWorkspace {
  readonly modelId:string;
  readonly root:string;
  private readonly storage:string;
  private readonly host:string;
  private readonly model:string;
  private readonly timeoutMs:number;
  private readonly maxPredictTokens:number;
  private readonly testRunner:(input:DockerTestInput)=>Promise<DockerTestResult>;
  private readonly activeTests=new Set<string>();
  constructor(config:{workspaceDir:string;profileDir:string;host?:string;model:string;timeoutMs?:number;maxPredictTokens?:number;testRunner?:(input:DockerTestInput)=>Promise<DockerTestResult>}){
    this.root=safeRoot(config.workspaceDir);
    const profile=safeRoot(config.profileDir);
    if(this.root===profile||this.root.startsWith(profile+sep)||profile.startsWith(this.root+sep))
      throw new Error("Werkmap en EAIwork-gegevens mogen niet in elkaar liggen");
    if(typeof config.model!=="string"||!config.model.trim()||config.model.length>120)
      throw new Error("Ongeldig Ollama-model");
    this.model=config.model;
    this.testRunner=config.testRunner??runIsolatedNodeTest;
    this.modelId="ollama:"+config.model;
    this.host=localOllamaHost(config.host);
    this.timeoutMs=config.timeoutMs??90000;
    if(!Number.isInteger(this.timeoutMs)||this.timeoutMs<1000||this.timeoutMs>120000)
      throw new Error("Ongeldige Ollama-timeout");
    this.maxPredictTokens=config.maxPredictTokens??5000;
    if(!Number.isInteger(this.maxPredictTokens)||this.maxPredictTokens<128||this.maxPredictTokens>5000)
      throw new Error("Ongeldige limiet voor modeltokens");
    this.storage=join(profile,"code-proposals");
    if(existsSync(this.storage)){
      if(lstatSync(this.storage).isSymbolicLink()||!lstatSync(this.storage).isDirectory())
        throw new Error("Codevoorstelmap is onveilig");
    }else mkdirSync(this.storage,{mode:0o700});
    if(process.platform!=="win32")chmodSync(this.storage,0o700);
  }
  /** A non-generating reachability check: it does not prove that inference succeeds. */
  async probeOllama(){
    try{
      const installed=await discoverLocalOllamaModels(this.host,3000);
      if(!installed.includes(this.model))
        return {status:"model-missing" as const,modelId:this.modelId,
          detail:"Ollama reageert, maar het ingestelde model is niet beschikbaar."};
      return {status:"ready" as const,modelId:this.modelId,
        detail:"Ollama reageert en het gekozen model staat lokaal klaar. Nog geen modelantwoord getest."};
    }catch{
      return {status:"unavailable" as const,modelId:this.modelId,
        detail:"Ollama reageert niet. Controleer of Ollama op deze computer draait."};
    }
  }
  /** Only the administrator-selected worktree is readable. No arbitrary paths. */
  fileSha256(path:string){
    return sha(this.readApprovedFile(path));
  }
  /** Read only a bounded existing source or test file in the selected worktree. */
  readApprovedFile(path:string){
    return readBounded(safeExistingFile(this.root,path));
  }
  get planDir(){return join(this.storage,"..","code-plans")}
  /** Tests the bytes that are already on disk after a reviewed apply. */
  async runAppliedTests(proposalId:string){
    const initial=this.record(proposalId);
    if(initial.status!=="applied"||!initial.testPath)
      throw new Error("Alleen een toegepaste wijziging met testbestand kan opnieuw worden getest");
    if(this.activeTests.has(proposalId))throw new Error("De test is al bezig");
    const source=safeExistingFile(this.root,initial.path);
    const testFile=safeExistingFile(this.root,initial.testPath);
    const candidate=readBounded(source),testSource=readBounded(testFile);
    if(sha(candidate)!==initial.replacementSha256||
       sha(initial.replacement)!==initial.replacementSha256)
      throw new Error("De toegepaste code wijkt af van het goedgekeurde voorstel");
    if(!initial.testReport||!validSingleFilePass(initial.testReport)||
       initial.testReport.candidateSha256!==initial.replacementSha256||
       initial.testReport.testSha256!==sha(testSource))
      throw new Error("De oorspronkelijke Docker-test is niet aantoonbaar geslaagd");
    this.activeTests.add(proposalId);
    try{
      const result=await this.testRunner({candidatePath:initial.path,
        candidateSource:candidate,testPath:initial.testPath,testSource});
      const latest=this.record(proposalId);
      if(latest.status!=="applied"||
         sha(readBounded(source))!==initial.replacementSha256||
         sha(readBounded(testFile))!==sha(testSource)||
         result.candidateSha256!==initial.replacementSha256||
         result.testSha256!==sha(testSource))
        throw new Error("Testuitkomst hoort niet bij de actuele bestandsversie");
      return result;
    }finally{this.activeTests.delete(proposalId)}
  }
  private record(id:string):ProposalRecord{
    if(!/^[0-9a-f-]{36}$/.test(id))throw new Error("Ongeldig voorstelnummer");
    const file=join(this.storage,id+".json");
    const info=lstatSync(file);
    if(!info.isFile()||info.isSymbolicLink()||info.size>100000)
      throw new Error("Voorstelbestand is ongeldig");
    const record=JSON.parse(readFileSync(file,"utf8")) as ProposalRecord;
    if(record.id!==id||!["requires-human-review","applied","restored"].includes(record.status))
      throw new Error("Voorstelbestand is onjuist");
    return record;
  }
  async propose(path:string,instruction:string,testPath?:string){
    if(typeof instruction!=="string"||!instruction.trim()||instruction.length>4000)
      throw new Error("Beschrijf een concrete wijziging van maximaal 4000 tekens");
    const file=safeExistingFile(this.root,path);
    const original=readBounded(file);
    if(testPath!==undefined){
      if(!path.endsWith(".js")||typeof testPath!=="string"||!testPath.endsWith(".test.js")||testPath===path)
        throw new Error("Docker-test vereist een .js-bron en apart .test.js-testbestand");
      readBounded(safeExistingFile(this.root,testPath));
    }
    const response=await fetch(this.host+"/api/chat",{
      method:"POST",redirect:"error",signal:AbortSignal.timeout(this.timeoutMs),
      headers:{"content-type":"application/json"},
      body:JSON.stringify({model:this.model,stream:false,
        format:{type:"object",properties:{
          replacement:{type:"string",maxLength:32768},
          explanation:{type:"string",maxLength:3000},
          checks:{type:"array",maxItems:8,items:{type:"string",maxLength:200}},
        },required:["replacement","explanation","checks"],additionalProperties:false},
        options:{temperature:0,num_predict:this.maxPredictTokens},
        messages:[{role:"user",content:JSON.stringify({
          instruction:"Propose the COMPLETE replacement for the single existing source file. Do not request shell commands, other file access, network, or publication. Give suggested checks but do not claim tests were executed.",
          userRequest:instruction,path,original,
        })}],
      })
    });
    const proposed=await boundedResponse(response);
    const id=randomUUID();
    const preflight=checkCodeSyntax(path,proposed.replacement);
    const record:ProposalRecord={id,path,original,sourceSha256:sha(original),
      replacementSha256:sha(proposed.replacement),replacement:proposed.replacement,
      explanation:proposed.explanation,checks:proposed.checks,modelId:this.modelId,
      createdAt:new Date().toISOString(),status:"requires-human-review",preflight,
      ...(testPath?{testPath}:{})};
    saveJson(join(this.storage,id+".json"),record);
    return {...record,originalBytes:Buffer.byteLength(original),
      replacementBytes:Buffer.byteLength(record.replacement)};
  }
  async runTests(proposalId:string){
    const initial=this.record(proposalId);
    if(initial.status!=="requires-human-review"||!initial.testPath)
      throw new Error("Dit voorstel heeft geen vrijgegeven testbestand");
    if(this.activeTests.has(proposalId))
      throw new Error("De Docker-test is al bezig");
    if(sha(initial.replacement)!==initial.replacementSha256)
      throw new Error("Codevoorstel is gewijzigd");
    const file=safeExistingFile(this.root,initial.path);
    if(sha(readBounded(file))!==initial.sourceSha256)
      throw new Error("Bronbestand is gewijzigd; vraag een nieuw voorstel");
    const testFile=safeExistingFile(this.root,initial.testPath);
    const testSource=readBounded(testFile);
    this.activeTests.add(proposalId);
    try{
      const result=await this.testRunner({
        candidatePath:initial.path,candidateSource:initial.replacement,
        testPath:initial.testPath,testSource
      });
      const latest=this.record(proposalId);
      if(latest.status!=="requires-human-review"||
         latest.replacementSha256!==initial.replacementSha256||
         sha(readBounded(file))!==initial.sourceSha256||
         sha(readBounded(testFile))!==result.testSha256)
        throw new Error("De bestanden zijn tijdens de test veranderd; resultaat niet opgeslagen");
      const checkedHashes=result.candidateSha256===initial.replacementSha256 &&
        result.testSha256===sha(testSource);
      if(!checkedHashes)throw new Error("De testuitslag hoort niet bij dit voorstel");
      if(result.status==="passed"&&!validSingleFilePass(result))
        throw new Error("De testuitkomst mist controleerbaar uitgevoerde Node-tests");
      saveJson(join(this.storage,initial.id+".json"),{...latest,testReport:result});
      return result;
    }finally{this.activeTests.delete(proposalId)}
  }
  inspect(proposalId:string){
    const record=this.record(proposalId);
    const file=safeExistingFile(this.root,record.path);
    const current=readBounded(file);
    const currentSha256=sha(current);
    const sourceUnchanged=currentSha256===record.sourceSha256;
    const validStoredReplacement=sha(record.replacement)===record.replacementSha256;
    if(!validStoredReplacement)throw new Error("Codevoorstel is veranderd");
    const original=typeof record.original==="string"?record.original:
      sourceUnchanged?current:null;
    if(original!==null&&sha(original)!==record.sourceSha256)
      throw new Error("Opgeslagen uitgangsversie is veranderd");
    const preflight=checkCodeSyntax(record.path,record.replacement);
    const testPassed=!record.testPath||(
      validSingleFilePass(record.testReport)&&
      record.testReport.candidateSha256===record.replacementSha256&&
      record.testReport.testSha256===sha(readBounded(safeExistingFile(this.root,record.testPath)))
    );
    const currentIsApplied=currentSha256===record.replacementSha256;
    const sourceChanged=record.status==="requires-human-review"? !sourceUnchanged :
      record.status==="applied"?!currentIsApplied:!sourceUnchanged;
    return {
      proposalId:record.id,id:record.id,path:record.path,modelId:record.modelId,
      createdAt:record.createdAt,status:record.status,
      explanation:record.explanation,checks:record.checks,replacement:record.replacement,
      sourceSha256:record.sourceSha256,replacementSha256:record.replacementSha256,
      sourceUnchanged,sourceChanged,currentSha256,
      replacementHashMatches:validStoredReplacement,
      preflight,testsExecuted:record.testReport?.testsExecuted??false,
      testPath:record.testPath??null,testReport:record.testReport??null,
      comparison:original===null?null:compareSource(original,record.replacement),
      canApply:record.status==="requires-human-review"&&sourceUnchanged&&validStoredReplacement&&
        testPassed&&preflight.status!=="failed"&&
        !!record.preflight&&record.preflight.replacementSha256===preflight.replacementSha256,
      canRestore:record.status==="applied"&&currentIsApplied,
    };
  }
  list(limit=20){
    if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error("Ongeldige geschiedenislimiet");
    return readdirSync(this.storage).filter(n=>/^[0-9a-f-]{36}\.json$/.test(n))
      .map(n=>this.record(n.slice(0,-5)))
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))
      .slice(0,limit).map(r=>({
        id:r.id,path:r.path,modelId:r.modelId,status:r.status,createdAt:r.createdAt,
        appliedAt:r.appliedAt??null,restoredAt:r.restoredAt??null,
        sourceSha256:r.sourceSha256,replacementSha256:r.replacementSha256
      }));
  }
  /**
   * Inspect an unfinished, journalled change without altering project files.
   * Reconciliation is conservative: unknown hashes always require manual review.
   */
  inspectPending(proposalId:string,action:"apply-started"|"restore-started"){
    const record=this.record(proposalId);
    let currentHash:string|null=null;
    try{currentHash=sha(readBounded(safeExistingFile(this.root,record.path)))}
    catch{return {proposalId,path:record.path,action,outcome:"manual-required" as const,
      reason:"Bronbestand ontbreekt of is niet veilig leesbaar"}}
    if(sha(record.replacement)!==record.replacementSha256||
       record.sourceSha256===record.replacementSha256)
      return {proposalId,path:record.path,action,outcome:"manual-required" as const,
        reason:"Opgeslagen code is gewijzigd of de hashes zijn niet te onderscheiden"};
    let backupValid=false;
    const backupPath=join(this.storage,record.id+".original");
    const backupExists=existsSync(backupPath);
    try{backupValid=sha(readBounded(backupPath))===record.sourceSha256}
    catch{backupValid=false}
    if(backupExists&&!backupValid)
      return {proposalId,path:record.path,action,outcome:"manual-required" as const,
        reason:"De bestaande back-up is beschadigd of komt niet overeen met het voorstel"};
    if(action==="apply-started"){
      if(currentHash===record.replacementSha256&&backupValid&&
         ["requires-human-review","applied"].includes(record.status))
        return {proposalId,path:record.path,action,outcome:"applied" as const,
          reason:"Vervangende bron en gecontroleerde back-up zijn aanwezig"};
      if(currentHash===record.sourceSha256&&record.status==="requires-human-review")
        return {proposalId,path:record.path,action,outcome:"aborted" as const,
          reason:"Bronbestand is nog ongewijzigd"};
    }else{
      if(currentHash===record.sourceSha256&&backupValid&&
         ["applied","restored"].includes(record.status))
        return {proposalId,path:record.path,action,outcome:"restored" as const,
          reason:"Oorspronkelijke bron en gecontroleerde back-up komen overeen"};
      if(currentHash===record.replacementSha256&&record.status==="applied")
        return {proposalId,path:record.path,action,outcome:"aborted" as const,
          reason:"De toegepaste code is nog aanwezig"};
    }
    return {proposalId,path:record.path,action,outcome:"manual-required" as const,
      reason:"Bestandsinhoud en opgeslagen voorstel spreken elkaar tegen"};
  }
  /**
   * Finalize proposal metadata only after a separately logged human confirmation.
   * The source file itself is never written by this recovery method.
   */
  reconcilePending(proposalId:string,action:"apply-started"|"restore-started",actorId:string){
    if(typeof actorId!=="string"||!actorId.startsWith("person:"))
      throw new Error("Alleen een persoon mag een onderbroken wijziging afronden");
    const check=this.inspectPending(proposalId,action);
    if(check.outcome==="manual-required")return check;
    if(check.outcome==="aborted")return check;
    const record=this.record(proposalId);
    if(check.outcome==="applied"&&record.status==="requires-human-review")
      saveJson(join(this.storage,record.id+".json"),{
        ...record,status:"applied",appliedAt:new Date().toISOString(),
        appliedBy:actorId,recoveredAfterInterruption:true
      });
    if(check.outcome==="restored"&&record.status==="applied")
      saveJson(join(this.storage,record.id+".json"),{
        ...record,status:"restored",restoredAt:new Date().toISOString(),
        restoredBy:actorId,recoveredAfterInterruption:true
      });
    return check;
  }
  apply(request:{proposalId:string;expectedSha256:string;approve:true},actorId:string,
    internalProof:{projectSuiteApproved?:boolean}={}){
    if(!request||request.approve!==true||typeof actorId!=="string"||!actorId.startsWith("person:"))
      throw new Error("Een persoon moet deze wijziging uitdrukkelijk goedkeuren");
    const record=this.record(request.proposalId);
    if(record.status!=="requires-human-review")throw new Error("Voorstel is al verwerkt");
    if(request.expectedSha256!==record.replacementSha256)
      throw new Error("Goedkeuring verwijst niet naar dezelfde code");
    const file=safeExistingFile(this.root,record.path);
    const original=readBounded(file);
    if(sha(original)!==record.sourceSha256)
      throw new Error("Bronbestand is gewijzigd; vraag een nieuw voorstel");
    if(sha(record.replacement)!==record.replacementSha256)
      throw new Error("Voorstelbestand is gewijzigd");
    const checked=this.inspect(record.id);
    // Only the server can supply this internal proof, after validating a
    // reviewed, source-bound project-suite result from the durable plan.
    const testedAsProject=internalProof.projectSuiteApproved===true&&
      !!record.testPath&&checked.sourceUnchanged&&
      checked.replacementHashMatches&&checked.preflight.status!=="failed"&&
      !!record.preflight&&
      record.preflight.replacementSha256===checked.preflight.replacementSha256;
    if(!checked.canApply&&!testedAsProject)
      throw new Error("Codecontrole mislukt of het voorstel is gewijzigd");
    const backUp=join(this.storage,record.id+".original");
    // An interrupted earlier attempt may have written the backup already.
    // Reuse it only if its bytes still match this exact original revision.
    if(existsSync(backUp)){
      if(sha(readBounded(backUp))!==record.sourceSha256)
        throw new Error("Eerdere back-up wijkt af; controleer het bronbestand handmatig");
    }else{
      const backupFd=openSync(backUp,"wx",0o600);
      try{writeFileSync(backupFd,original);fsyncSync(backupFd)}finally{closeSync(backupFd)}
    }
    const target=file+"."+randomUUID()+".eaiwork-tmp";
    let renamed=false;
    try{
      const fd=openSync(target,"wx",0o600);
      try{writeFileSync(fd,record.replacement);fsyncSync(fd)}finally{closeSync(fd)}
      // Keep the source file's permissions; no shell execution is performed.
      chmodSync(target,lstatSync(file).mode&0o777);
      if(sha(readBounded(file))!==record.sourceSha256)
        throw new Error("Bronbestand is opnieuw gewijzigd; wijziging niet toegepast");
      renameSync(target,file);renamed=true;
    }finally{if(!renamed&&existsSync(target))unlinkSync(target)}
    saveJson(join(this.storage,record.id+".json"),{
      ...record,status:"applied",appliedAt:new Date().toISOString(),appliedBy:actorId
    });
    return {status:"applied",proposalId:record.id,path:record.path,
      sha256:record.replacementSha256,backupRef:record.id+".original",
      testsExecuted:false,preflight:checked.preflight};
  }
  restore(request:{proposalId:string;expectedSha256:string;approve:true},actorId:string){
    if(!request||request.approve!==true||typeof actorId!=="string"||!actorId.startsWith("person:"))
      throw new Error("Herstel vereist uitdrukkelijke goedkeuring door een persoon");
    const record=this.record(request.proposalId);
    if(record.status!=="applied"||request.expectedSha256!==record.replacementSha256)
      throw new Error("Dit voorstel kan niet worden hersteld met deze goedkeuring");
    const file=safeExistingFile(this.root,record.path);
    if(sha(readBounded(file))!==record.replacementSha256)
      throw new Error("Bestand is na het toepassen aangepast: herstel geweigerd");
    const backUp=join(this.storage,record.id+".original");
    if(!lstatSync(backUp).isFile()||lstatSync(backUp).isSymbolicLink())
      throw new Error("De oorspronkelijke back-up is niet beschikbaar");
    const original=readBounded(backUp);
    if(sha(original)!==record.sourceSha256)
      throw new Error("Back-up is veranderd");
    const target=file+"."+randomUUID()+".eaiwork-restore";
    let renamed=false;
    try{
      const fd=openSync(target,"wx",0o600);
      try{writeFileSync(fd,original);fsyncSync(fd)}finally{closeSync(fd)}
      chmodSync(target,lstatSync(file).mode&0o777);
      if(sha(readBounded(file))!==record.replacementSha256)
        throw new Error("Bestand is tijdens herstel aangepast");
      renameSync(target,file);renamed=true;
    }finally{if(!renamed&&existsSync(target))unlinkSync(target)}
    saveJson(join(this.storage,record.id+".json"),{
      ...record,status:"restored",restoredAt:new Date().toISOString(),restoredBy:actorId
    });
    return {status:"restored",proposalId:record.id,path:record.path,
      sha256:record.sourceSha256,testsExecuted:false};
  }
}

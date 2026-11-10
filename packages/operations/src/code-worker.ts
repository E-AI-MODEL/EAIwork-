/** Local Ollama code proposal. No model-initiated writes, commands or network egress. */
import {createHash,randomUUID} from "node:crypto";
import {chmodSync,closeSync,existsSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,renameSync,unlinkSync,writeFileSync} from "node:fs";
import {isAbsolute,join,relative,resolve,sep} from "node:path";
import {localOllamaHost} from "../../gateway/src/ollama-provider.ts";
import {checkCandidate,compareSource} from "./code-review.ts";

type ProposalRecord={
  id:string;path:string;sourceSha256:string;replacementSha256:string;
  replacement:string;original?:string;explanation:string;checks:string[];
  createdAt:string;modelId:string;status:"requires-human-review"|"applied"|"restored";
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
  constructor(config:{workspaceDir:string;profileDir:string;host?:string;model:string;timeoutMs?:number}){
    this.root=safeRoot(config.workspaceDir);
    const profile=safeRoot(config.profileDir);
    if(this.root===profile||this.root.startsWith(profile+sep)||profile.startsWith(this.root+sep))
      throw new Error("Werkmap en EAIwork-gegevens mogen niet in elkaar liggen");
    if(typeof config.model!=="string"||!config.model.trim()||config.model.length>120)
      throw new Error("Ongeldig Ollama-model");
    this.model=config.model;
    this.modelId="ollama:"+config.model;
    this.host=localOllamaHost(config.host);
    this.timeoutMs=config.timeoutMs??90000;
    if(!Number.isInteger(this.timeoutMs)||this.timeoutMs<1000||this.timeoutMs>120000)
      throw new Error("Ongeldige Ollama-timeout");
    this.storage=join(profile,"code-proposals");
    if(existsSync(this.storage)){
      if(lstatSync(this.storage).isSymbolicLink()||!lstatSync(this.storage).isDirectory())
        throw new Error("Codevoorstelmap is onveilig");
    }else mkdirSync(this.storage,{mode:0o700});
    if(process.platform!=="win32")chmodSync(this.storage,0o700);
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
  async propose(path:string,instruction:string){
    if(typeof instruction!=="string"||!instruction.trim()||instruction.length>4000)
      throw new Error("Beschrijf een concrete wijziging van maximaal 4000 tekens");
    const file=safeExistingFile(this.root,path);
    const original=readBounded(file);
    const response=await fetch(this.host+"/api/chat",{
      method:"POST",redirect:"error",signal:AbortSignal.timeout(this.timeoutMs),
      headers:{"content-type":"application/json"},
      body:JSON.stringify({model:this.model,stream:false,
        format:{type:"object",properties:{
          replacement:{type:"string",maxLength:32768},
          explanation:{type:"string",maxLength:3000},
          checks:{type:"array",maxItems:8,items:{type:"string",maxLength:200}},
        },required:["replacement","explanation","checks"],additionalProperties:false},
        options:{temperature:0,num_predict:5000},
        messages:[{role:"user",content:JSON.stringify({
          instruction:"Propose the COMPLETE replacement for the single existing source file. Do not request shell commands, other file access, network, or publication. Give suggested checks but do not claim tests were executed.",
          userRequest:instruction,path,original,
        })}],
      })
    });
    const proposed=await boundedResponse(response);
    const id=randomUUID();
    const record:ProposalRecord={id,path,original,sourceSha256:sha(original),
      replacementSha256:sha(proposed.replacement),replacement:proposed.replacement,
      explanation:proposed.explanation,checks:proposed.checks,modelId:this.modelId,
      createdAt:new Date().toISOString(),status:"requires-human-review"};
    saveJson(join(this.storage,id+".json"),record);
    return {...record,originalBytes:Buffer.byteLength(original),
      replacementBytes:Buffer.byteLength(record.replacement)};
  }
  inspect(id:string){
    const record=this.record(id);
    if(typeof record.replacement!=="string"||sha(record.replacement)!==record.replacementSha256)
      throw new Error("Het opgeslagen codevoorstel is veranderd");
    const file=safeExistingFile(this.root,record.path);
    const current=readBounded(file),currentSha256=sha(current);
    const original=typeof record.original==="string"?record.original:
      currentSha256===record.sourceSha256?current:null;
    if(original!==null&&sha(original)!==record.sourceSha256)
      throw new Error("De opgeslagen uitgangsversie is veranderd");
    const sourceChanged=record.status==="requires-human-review"?
      currentSha256!==record.sourceSha256:
      record.status==="applied"?currentSha256!==record.replacementSha256:
      currentSha256!==record.sourceSha256;
    const check=checkCandidate(record.path,record.replacement);
    return {...record,original:undefined,sourceChanged,currentSha256,
      comparison:original===null?null:compareSource(original,record.replacement),
      staticCheck:check,
      canApply:record.status==="requires-human-review"&&!sourceChanged&&check.status!=="failed",
      canRestore:record.status==="applied"&&!sourceChanged,
      testsExecuted:false};
  }
  list(limit=20){
    if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error("Ongeldige geschiedenislimiet");
    return readdirSync(this.storage).filter(n=>/^[0-9a-f-]{36}\.json$/.test(n))
      .map(n=>this.record(n.slice(0,-5)))
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))
      .slice(0,limit).map(r=>({
        id:r.id,path:r.path,modelId:r.modelId,status:r.status,createdAt:r.createdAt,
        appliedAt:r.appliedAt??null,restoredAt:r.restoredAt??null,
        sourceSha256:r.sourceSha256,replacementSha256:r.replacementSha256,
      }));
  }
  apply(request:{proposalId:string;expectedSha256:string;approve:true},actorId:string){
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
    const staticCheck=checkCandidate(record.path,record.replacement);
    if(staticCheck.status==="failed")throw new Error("Het voorstel faalt de syntaxiscontrole");
    const backUp=join(this.storage,record.id+".original");
    const backupFd=openSync(backUp,"wx",0o600);
    try{writeFileSync(backupFd,original);fsyncSync(backupFd)}finally{closeSync(backupFd)}
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
      staticCheck,testsExecuted:false};
  }
  restore(request:{proposalId:string;expectedSha256:string;approve:true},actorId:string){
    if(!request||request.approve!==true||typeof actorId!=="string"||!actorId.startsWith("person:"))
      throw new Error("Herstellen vereist uitdrukkelijke goedkeuring door een persoon");
    const record=this.record(request.proposalId);
    if(record.status!=="applied"||request.expectedSha256!==record.replacementSha256)
      throw new Error("Dit voorstel kan niet met deze goedkeuring worden hersteld");
    const file=safeExistingFile(this.root,record.path);
    if(sha(readBounded(file))!==record.replacementSha256)
      throw new Error("De code is na de wijziging aangepast: herstel geweigerd");
    const backup=join(this.storage,record.id+".original");
    if(!lstatSync(backup).isFile()||lstatSync(backup).isSymbolicLink())
      throw new Error("De oorspronkelijke back-up is niet beschikbaar");
    const original=readBounded(backup);
    if(sha(original)!==record.sourceSha256)
      throw new Error("De back-up komt niet overeen met het oorspronkelijke bestand");
    const temporary=file+"."+randomUUID()+".eaiwork-restore";
    let renamed=false;
    try{
      const fd=openSync(temporary,"wx",0o600);
      try{writeFileSync(fd,original);fsyncSync(fd)}finally{closeSync(fd)}
      chmodSync(temporary,lstatSync(file).mode&0o777);
      if(sha(readBounded(file))!==record.replacementSha256)
        throw new Error("Bestand gewijzigd tijdens herstel");
      renameSync(temporary,file);renamed=true;
    }finally{if(!renamed&&existsSync(temporary))unlinkSync(temporary)}
    saveJson(join(this.storage,record.id+".json"),{
      ...record,status:"restored",restoredAt:new Date().toISOString(),restoredBy:actorId,
    });
    return {status:"restored",proposalId:record.id,path:record.path,
      sha256:record.sourceSha256,testsExecuted:false};
  }
}

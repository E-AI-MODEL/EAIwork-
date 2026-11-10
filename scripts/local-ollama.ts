/**
 * Start the existing local EAIwork operations server with a real Ollama planner.
 * Ollama only proposes plans. Human approval, task authority and local effects
 * remain with the EAIwork operations server.
 */
import {pathToFileURL,fileURLToPath} from "node:url";
import {createInterface} from "node:readline/promises";
import {copyFileSync,mkdirSync,mkdtempSync} from "node:fs";
import {homedir} from "node:os";
import {resolve,join,dirname} from "node:path";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "./local-demo.ts";
import {defaultLocalProfileDir,openLocalProfile} from "./local-profile.ts";
import {LocalCodeWorkspace} from "../packages/operations/src/code-worker.ts";
import {localOllamaHost,discoverLocalOllamaModels} from "../packages/gateway/src/ollama-provider.ts";
import {localOllamaPlanningModel} from "../packages/operations/src/planner.ts";

export interface LocalOllamaOptions {
  model?:string;
  host?:string;
  port?:number;
  timeoutMs?:number;
  dataDir?:string;
  worktreeDir?:string;
  example?:boolean;
  selectModel?:(models:string[])=>Promise<string>;
}
export function chooseInstalledModel(installed:string[],requested?:string):string{
  const names=[...new Set(installed.filter(v=>typeof v==="string" && v.length>0))].sort();
  if(requested){
    if(!names.includes(requested))throw new Error("Het gekozen Ollama-model is niet lokaal geinstalleerd. Beschikbaar: "+(names.join(", ")||"geen"));
    return requested;
  }
  if(names.length===1)return names[0];
  if(names.length===0)throw new Error("Geen Ollama-modellen gevonden. Installeer eerst een model met: ollama pull qwen2.5:1.5b");
  throw new Error("Kies een lokaal model met --model=NAAM. Beschikbaar: "+names.join(", "));
}
/**
 * A numbered menu avoids copying long Ollama model IDs.
 * Keep this separate from readline so menu behavior is easy to test.
 */
export async function chooseModelFromMenu(
  installed:string[],
  ask:(question:string)=>Promise<string>,
  write:(message:string)=>void
):Promise<string>{
  const names=[...new Set(installed.filter(x=>typeof x==="string"&&x.trim()))].sort();
  if(names.length<=1)return chooseInstalledModel(names);
  write("\nKies je lokale Ollama-model:\n");
  names.forEach((name,index)=>write("  "+(index+1)+". "+name+"\n"));
  for(let attempt=0;attempt<5;attempt++){
    const raw=(await ask("Typ het nummer en druk op Enter: ")).trim();
    const index=/^[0-9]+$/.test(raw)?Number(raw)-1:-1;
    if(Number.isSafeInteger(index)&&index>=0&&index<names.length)return names[index];
    write("Kies een nummer uit de lijst.\n");
  }
  throw new Error("Er is geen geldig model gekozen. Start de opdracht opnieuw.");
}
function makeExampleWorktree():string{
  const destination=mkdtempSync(join(homedir(),"eaiwork-proef-"));
  const source=fileURLToPath(new URL("../examples/multifile-smoke/",import.meta.url));
  for(const path of ["src/amount.js","src/invoice.js",
    "tests/amount.test.js","tests/invoice.test.js"]){
    const output=join(destination,path);
    mkdirSync(dirname(output),{recursive:true});
    copyFileSync(join(source,path),output);
  }
  return destination;
}
export function parseLocalOllamaArgs(args:string[],env:NodeJS.ProcessEnv=process.env):LocalOllamaOptions{
  const result:LocalOllamaOptions={
    host:env.EAI_OLLAMA_HOST||"http://127.0.0.1:11434",
    model:env.EAI_OLLAMA_MODEL||undefined,
    port:Number(env.EAI_DEMO_PORT||8788),
    timeoutMs:90000,
    dataDir:env.EAI_LOCAL_DATA_DIR||defaultLocalProfileDir(),
    ...(env.EAI_CODE_WORKTREE?{worktreeDir:env.EAI_CODE_WORKTREE}:{}),
  };
  const seen=new Set<string>();
  for(const arg of args){
    if(arg==="--example"){
      if(seen.has("example"))throw new Error("Gebruik --example slechts één keer");
      seen.add("example");result.example=true;continue;
    }
    const match=/^--(model|host|port|timeout-ms|data-dir|worktree)=(.+)$/.exec(arg);
    if(!match||seen.has(match[1]))throw new Error("Gebruik --model=NAAM, --host=LOOPBACK, --port=NUMMER of --timeout-ms=NUMMER of --data-dir=MAP of --worktree=MAP");
    seen.add(match[1]);
    if(match[1]==="model")result.model=match[2];
    if(match[1]==="host")result.host=match[2];
    if(match[1]==="port")result.port=Number(match[2]);
    if(match[1]==="timeout-ms")result.timeoutMs=Number(match[2]);
    if(match[1]==="data-dir")result.dataDir=match[2];
    if(match[1]==="worktree")result.worktreeDir=match[2];
  }
  if(result.example&&result.worktreeDir)
    throw new Error("Gebruik --example niet samen met --worktree");
  localOllamaHost(result.host);
  if(result.model && (result.model.length>120||!/^[-\w.:/]+$/.test(result.model)))
    throw new Error("Ongeldige lokale modelnaam");
  if(!Number.isInteger(result.port)||result.port<1024||result.port>65535)
    throw new Error("Dashboardpoort moet tussen 1024 en 65535 liggen");
  if(!Number.isInteger(result.timeoutMs)||result.timeoutMs<1000||result.timeoutMs>120000)
    throw new Error("Ollama-timeout moet tussen 1000 en 120000 ms liggen");
  return result;
}
export async function startLocalOllama(options:LocalOllamaOptions={}){
  const host=localOllamaHost(options.host);
  const port=options.port??8788;
  const timeoutMs=options.timeoutMs??90000;
  if(!Number.isInteger(port)||(port!==0&&port<1024)||port>65535)
    throw new Error("Ongeldige dashboardpoort");
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)
    throw new Error("Ongeldige Ollama-timeout");
  let installed:string[];
  try{installed=await discoverLocalOllamaModels(host,5000)}
  catch{throw new Error("Ollama reageert niet op "+host+". Start Ollama op deze computer en probeer opnieuw.")}
  const chosen=options.model??(installed.length>1&&options.selectModel?
    await options.selectModel(installed):undefined);
  const model=chooseInstalledModel(installed,chosen);
  if(options.example&&options.worktreeDir)
    throw new Error("Gebruik --example niet samen met een eigen werkmap");
  const worktreeDir=options.example?makeExampleWorktree():options.worktreeDir;
  const profileDir=options.dataDir??defaultLocalProfileDir();
  const codeWorkspace=worktreeDir?new LocalCodeWorkspace({
    workspaceDir:worktreeDir,profileDir:openLocalProfile(profileDir).root,
    model,host,timeoutMs,
  }):undefined;
  const demo=createDemoServer({
    planningModel:localOllamaPlanningModel({model,host,timeoutMs}),
    persistentDir:profileDir,codeWorkspace,
  });
  try{
    await new Promise<void>((done,reject)=>{
      const failed=(error:Error)=>{demo.server.off("listening",done);reject(error)};
      demo.server.once("error",failed);
      demo.server.once("listening",()=>{demo.server.off("error",failed);done()});
      demo.server.listen(port,"127.0.0.1");
    });
  }catch(error){await demo.close();throw error}
  const actualPort=(demo.server.address() as AddressInfo).port;
  return {...demo,model,ollamaHost:host,codeWorktree:codeWorkspace?.root??null,address:"http://127.0.0.1:"+actualPort+"/dashboard"};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const options=parseLocalOllamaArgs(process.argv.slice(2));
    const local=await startLocalOllama({
      ...options,
      selectModel:process.stdin.isTTY&&process.stdout.isTTY?async models=>{
        const line=createInterface({input:process.stdin,output:process.stdout});
        try{return await chooseModelFromMenu(models,
          question=>line.question(question),
          message=>process.stdout.write(message))}
        finally{line.close()}
      }:undefined,
    });
    process.stdout.write(
      "\nEAIwork lokaal met Ollama\n"+
      "Dashboard: "+local.address+"\n"+
      "Model voor planvoorstellen: "+local.model+" (Ollama op "+local.ollamaHost+")\n"+
      "Toegangstoken: "+local.token+"\n"+
      "Blijvende opslag: "+local.storageDir+"\n"+
      (local.codeWorktree?"Codevoorstellen voor: "+local.codeWorktree+"\n":"") +
      (options.example?"Dit is een nieuwe voorbeeldmap. Je eigen projecten blijven ongewijzigd.\n":"")+"\n"+
      "Open het dashboard, ga naar Meer > Contracten en registratie en verbind met het token.\n"+
      "Ga vervolgens naar Echte uitvoering en vraag een planvoorstel aan.\n"+
      "Het model mag alleen voorstellen doen. Jij keurt plannen en uitvoering goed.\n"+
      (local.codeWorktree?"De codeworker is beschikbaar onder Meer > Codeworker. Hij voert nooit zelf code uit.\n":"")+
      "Opdrachten en logboeken blijven na afsluiten bewaard. Maak zelf een back-up van deze lokale map.\n"+
      "Stop met Ctrl+C.\n\n"
    );
    let stopping=false;
    const stop=async()=>{if(stopping)return;stopping=true;await local.close();process.exit(0)};
    process.on("SIGINT",()=>{void stop()});
    process.on("SIGTERM",()=>{void stop()});
  }catch(error){
    // Never echo response bodies, tokens or user prompts.
    const message=error instanceof Error?error.message:"EAIwork kon niet starten";
    process.stderr.write("EAIwork/Ollama: "+message+"\n");
    process.exitCode=1;
  }
}

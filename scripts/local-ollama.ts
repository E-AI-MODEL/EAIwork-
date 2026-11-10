/**
 * Start the existing local EAIwork operations server with a real Ollama planner.
 * Ollama only proposes plans. Human approval, task authority and local effects
 * remain with the EAIwork operations server.
 */
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import type {AddressInfo} from "node:net";
import {createDemoServer} from "./local-demo.ts";
import {localOllamaHost,discoverLocalOllamaModels} from "../packages/gateway/src/ollama-provider.ts";
import {localOllamaPlanningModel} from "../packages/operations/src/planner.ts";

export interface LocalOllamaOptions {
  model?:string;
  host?:string;
  port?:number;
  timeoutMs?:number;
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
export function parseLocalOllamaArgs(args:string[],env:NodeJS.ProcessEnv=process.env):LocalOllamaOptions{
  const result:LocalOllamaOptions={
    host:env.EAI_OLLAMA_HOST||"http://127.0.0.1:11434",
    model:env.EAI_OLLAMA_MODEL||undefined,
    port:Number(env.EAI_DEMO_PORT||8788),
    timeoutMs:90000,
  };
  const seen=new Set<string>();
  for(const arg of args){
    const match=/^--(model|host|port|timeout-ms)=(.+)$/.exec(arg);
    if(!match||seen.has(match[1]))throw new Error("Gebruik --model=NAAM, --host=LOOPBACK, --port=NUMMER of --timeout-ms=NUMMER");
    seen.add(match[1]);
    if(match[1]==="model")result.model=match[2];
    if(match[1]==="host")result.host=match[2];
    if(match[1]==="port")result.port=Number(match[2]);
    if(match[1]==="timeout-ms")result.timeoutMs=Number(match[2]);
  }
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
  const model=chooseInstalledModel(installed,options.model);
  const demo=createDemoServer({
    planningModel:localOllamaPlanningModel({model,host,timeoutMs}),
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
  return {...demo,model,ollamaHost:host,address:"http://127.0.0.1:"+actualPort+"/dashboard"};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const options=parseLocalOllamaArgs(process.argv.slice(2));
    const local=await startLocalOllama(options);
    process.stdout.write(
      "\nEAIwork lokaal met Ollama\n"+
      "Dashboard: "+local.address+"\n"+
      "Model voor planvoorstellen: "+local.model+" (Ollama op "+local.ollamaHost+")\n"+
      "Toegangstoken: "+local.token+"\n\n"+
      "Open het dashboard, ga naar Meer > Contracten en registratie en verbind met het token.\n"+
      "Ga vervolgens naar Echte uitvoering en vraag een planvoorstel aan.\n"+
      "Het model mag alleen voorstellen doen. Jij keurt plannen en uitvoering goed.\n"+
      "Dit is nog een tijdelijke proef: na stoppen worden de demogegevens verwijderd.\n"+
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

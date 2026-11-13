/** Run a fixed list of approved JavaScript sources and node:test files together.
 * Only supplied bytes are staged. No repository mount, npm scripts or model commands.
 */
import {createHash,randomUUID} from "node:crypto";
import {spawn,spawnSync} from "node:child_process";
import {chmodSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join} from "node:path";
import {inspectNodeTestOutput} from "./docker-test-outcome.ts";

export type ProjectTestFile={path:string;content:string};
export type ProjectTestInput={files:ProjectTestFile[];testPaths:string[]};
export type ProjectTestResult={
  runner:"docker-project-node-v1";
  proofFormat?:"tap-named-v2"; // Old saved reports without this cannot authorize new changes.
  status:"passed"|"failed"|"unavailable";
  manifestSha256:string;
  fileCount:number;testPaths:string[];
  imageId:string|null;testsExecuted:boolean;exitCode:number|null;
  timedOut:boolean;output:string;recordedAt:string;
};
const sha=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");
const environment=()=>({
  PATH:process.env.PATH||"",HOME:process.env.HOME||"",
  ...(process.env.DOCKER_HOST?{DOCKER_HOST:process.env.DOCKER_HOST}:{}),
  ...(process.env.DOCKER_CONFIG?{DOCKER_CONFIG:process.env.DOCKER_CONFIG}:{}),
  ...(process.env.XDG_RUNTIME_DIR?{XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR}:{})
});
const safe=(path:string)=>typeof path==="string"&&path.length<=240&&
  !path.includes("\\")&&!path.includes("\0")&&
  path.split("/").every(p=>p&&p!=="."&&p!==".."&&!p.startsWith(".")&&
    p!=="node_modules"&&p!=="dist"&&p!=="vendor"&&p!=="build"&&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(p))&&path.endsWith(".js");
export function validateProjectInput(input:ProjectTestInput):ProjectTestInput{
  if(!input||!Array.isArray(input.files)||!Array.isArray(input.testPaths)||
     input.files.length<4||input.files.length>16||
     input.testPaths.length<2||input.testPaths.length>8)
    throw new Error("Gebruik twee tot acht bronnen met eigen JavaScript-tests");
  const paths=new Set<string>();
  let total=0,sourceCount=0;
  for(const file of input.files){
    if(!file||!safe(file.path)||typeof file.content!=="string"||
       file.content.includes("\0")||paths.has(file.path))
      throw new Error("Ongeldig of dubbel bestand in de testkopie");
    const size=Buffer.byteLength(file.content);
    if(size>32768)throw new Error("Testbestand is groter dan 32 KiB");
    total+=size;
    paths.add(file.path);
    if(!file.path.endsWith(".test.js"))sourceCount++;
  }
  if(total>16*32768||sourceCount<2||sourceCount>input.testPaths.length||
     input.testPaths.some(path=>!safe(path)||!path.endsWith(".test.js")||!paths.has(path))||
     new Set(input.testPaths).size!==input.testPaths.length||
     input.files.filter(file=>file.path.endsWith(".test.js")).length!==input.testPaths.length)
    throw new Error("Testkopie mist bronnen of heeft ongeldige testpaden");
  return {files:[...input.files].sort((a,b)=>a.path.localeCompare(b.path)),
    testPaths:[...input.testPaths].sort()};
}
export function projectManifestSha256(input:ProjectTestInput):string{
  const valid=validateProjectInput(input);
  return sha(JSON.stringify({
    files:valid.files.map(file=>({path:file.path,sha256:sha(file.content)})),
    testPaths:valid.testPaths
  }));
}
const absent=(input:ProjectTestInput,detail:string):ProjectTestResult=>({
  runner:"docker-project-node-v1",proofFormat:"tap-named-v2",status:"unavailable",
  manifestSha256:projectManifestSha256(input),fileCount:input.files.length,
  testPaths:[...input.testPaths].sort(),imageId:null,testsExecuted:false,
  exitCode:null,timedOut:false,output:detail.slice(0,1000),
  recordedAt:new Date().toISOString()
});
export async function runIsolatedProjectSuite(raw:ProjectTestInput):Promise<ProjectTestResult>{
  const input=validateProjectInput(raw);
  const fingerprint=projectManifestSha256(input);
  if(process.platform==="win32")return absent(input,
    "De afgeschermde Docker-tests zijn voor macOS en Linux gemaakt. Windows is nog niet gecontroleerd.");
  const inspected=spawnSync("docker",["image","inspect","--format","{{.Id}}","node:22-alpine"],{
    encoding:"utf8",timeout:4000,maxBuffer:2000,windowsHide:true,env:environment()
  });
  if(inspected.error||inspected.status!==0)return absent(input,
    "Docker of de lokale afbeelding node:22-alpine ontbreekt. Er is niets uitgevoerd.");
  const imageId=inspected.stdout.trim();
  if(!/^sha256:[a-f0-9]{64}$/.test(imageId))
    return absent(input,"Docker gaf geen controleerbare afbeelding-ID terug.");
  const stage=mkdtempSync(join(tmpdir(),"eaiwork-project-test-"));
  const container="eaiwork-project-"+randomUUID();
  let output="",exitCode:number|null=null,timedOut=false;
  const add=(chunk:Buffer)=>{output=(output+chunk.toString("utf8")).slice(-12000)};
  try{
    if(/[,\r\n]/.test(stage))throw new Error("Tijdelijk bestandspad is niet geschikt");
    chmodSync(stage,0o755);
    for(const file of input.files){
      const target=join(stage,file.path);
      mkdirSync(dirname(target),{recursive:true,mode:0o755});
      writeFileSync(target,file.content,{flag:"wx",mode:0o644});
    }
    writeFileSync(join(stage,"package.json"),'{"type":"module"}\n',{flag:"wx",mode:0o644});
    const args=["run","--rm","--pull=never","--name",container,
      "--network=none","--read-only","--cap-drop=ALL",
      "--security-opt=no-new-privileges","--user=65534:65534",
      "--pids-limit=64","--memory=384m","--cpus=1",
      "--tmpfs","/tmp:rw,nosuid,nodev,size=16m,mode=1777",
      "--mount","type=bind,src="+stage+",dst=/work,readonly",
      "--workdir","/work",imageId,"node","--test","--test-reporter=tap",...input.testPaths];
    const outcome=await new Promise<{code:number|null;error?:string}>(resolve=>{
      const child=spawn("docker",args,{
        stdio:["ignore","pipe","pipe"],shell:false,windowsHide:true,env:environment()
      });
      let finished=false;
      const finish=(value:{code:number|null;error?:string})=>{
        if(finished)return;
        finished=true;clearTimeout(timer);resolve(value);
      };
      child.stdout.on("data",add);child.stderr.on("data",add);
      child.once("error",e=>finish({code:null,error:e.message}));
      child.once("close",code=>finish({code}));
      const timer=setTimeout(()=>{timedOut=true;child.kill("SIGKILL")},30000);
    });
    exitCode=outcome.code;
    if(outcome.error)output+="\n"+outcome.error.slice(0,500);
  }finally{
    spawnSync("docker",["rm","-f",container],{
      timeout:4000,encoding:"utf8",stdio:"ignore",windowsHide:true,env:environment()
    });
    rmSync(stage,{recursive:true,force:true});
  }
  const summary=inspectNodeTestOutput(output,input.testPaths.length);
  return {runner:"docker-project-node-v1",proofFormat:"tap-named-v2",
    status:!summary.testsExecuted?"unavailable":timedOut||exitCode!==0||!summary.passed?"failed":"passed",
    manifestSha256:fingerprint,fileCount:input.files.length,
    testPaths:input.testPaths,imageId,testsExecuted:summary.testsExecuted,exitCode,timedOut,
    output:output.slice(0,12000),recordedAt:new Date().toISOString()};
}

/**
 * Optional local Docker test runner for one JavaScript candidate and one test.
 * Only the copied candidate and test are visible in the container.
 * No model-controlled commands, shell, network, writable worktree or host secrets.
 */
import {randomUUID,createHash} from "node:crypto";
import {spawn,spawnSync} from "node:child_process";
import {chmodSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join} from "node:path";

export type DockerTestResult={
  status:"passed"|"failed"|"unavailable";
  runner:"docker-node-test-v1";
  candidateSha256:string;
  testSha256:string;
  imageId:string|null;
  testsExecuted:boolean;
  exitCode:number|null;
  timedOut:boolean;
  output:string;
  recordedAt:string;
};
export type DockerTestInput={
  candidatePath:string;candidateSource:string;
  testPath:string;testSource:string;
};
const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const environment=()=>({
  PATH:process.env.PATH||"",
  HOME:process.env.HOME||"",
  ...(process.env.DOCKER_HOST?{DOCKER_HOST:process.env.DOCKER_HOST}:{}),
  ...(process.env.DOCKER_CONFIG?{DOCKER_CONFIG:process.env.DOCKER_CONFIG}:{}),
  ...(process.env.XDG_RUNTIME_DIR?{XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR}:{}),
});
const safePath=(path:string)=>typeof path==="string" && path.length<=240 &&
  path.split("/").every(x=>x.length>0&&x!=="."&&x!==".."&&!x.startsWith(".")&&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(x)) &&
  !path.includes("\\")&&!path.includes("\0");
const unavailable=(candidate:string,test:string,detail:string):DockerTestResult=>({
  status:"unavailable",runner:"docker-node-test-v1",
  candidateSha256:sha(candidate),testSha256:sha(test),imageId:null,
  testsExecuted:false,exitCode:null,timedOut:false,
  output:detail.slice(0,1000),recordedAt:new Date().toISOString(),
});
export async function runIsolatedNodeTest(input:DockerTestInput):Promise<DockerTestResult>{
  const {candidatePath,candidateSource,testPath,testSource}=input;
  if(!safePath(candidatePath)||!safePath(testPath)||
      !candidatePath.endsWith(".js")||!testPath.endsWith(".test.js")||
      candidatePath===testPath||typeof candidateSource!=="string"||
      typeof testSource!=="string"||
      Buffer.byteLength(candidateSource)>32768||
      Buffer.byteLength(testSource)>32768)
    throw new Error("Docker-test vereist een bestaand .js-bestand en een apart .test.js-bestand");
  if(process.platform==="win32")
    return unavailable(candidateSource,testSource,
      "Deze eerste Docker-test is getest voor macOS en Linux. Windows nog niet gecontroleerd.");
  const inspected=spawnSync("docker",[
    "image","inspect","--format","{{.Id}}","node:22-alpine"
  ],{encoding:"utf8",timeout:4000,maxBuffer:2000,windowsHide:true,env:environment()});
  if(inspected.error||inspected.status!==0)
    return unavailable(candidateSource,testSource,
      "Docker is niet bereikbaar of node:22-alpine staat niet lokaal. Installeer Docker en voer docker pull node:22-alpine uit.");
  const imageId=inspected.stdout.trim();
  if(!/^sha256:[a-f0-9]{64}$/.test(imageId))
    return unavailable(candidateSource,testSource,
      "Docker heeft geen controleerbare lokale afbeelding teruggegeven.");
  const stage=mkdtempSync(join(tmpdir(),"eaiwork-node-sandbox-"));
  const name="eaiwork-check-"+randomUUID();
  let timedOut=false,output="",exitCode:number|null=null;
  const append=(chunk:Buffer)=>{output=(output+chunk.toString("utf8")).slice(-12000)};
  try{
    if(/[,\r\n]/.test(stage))throw new Error("Ongeldige tijdelijke map voor Docker");
    chmodSync(stage,0o755);
    for(const [path,source] of [[candidatePath,candidateSource],[testPath,testSource]] as const){
      const file=join(stage,path);
      mkdirSync(dirname(file),{recursive:true,mode:0o755});
      writeFileSync(file,source,{mode:0o644,flag:"wx"});
    }
    writeFileSync(join(stage,"package.json"),'{"type":"module"}\n',{mode:0o644,flag:"wx"});
    const args=[
      "run","--rm","--pull=never","--name",name,
      "--network=none","--read-only","--cap-drop=ALL",
      "--security-opt=no-new-privileges","--user=65534:65534",
      "--pids-limit=64","--memory=256m","--cpus=1",
      "--tmpfs","/tmp:rw,nosuid,nodev,size=16m,mode=1777",
      "--mount","type=bind,src="+stage+",dst=/work,readonly",
      "--workdir","/work",imageId,
      "node","--test",testPath
    ];
    const result=await new Promise<{code:number|null;error?:string}>(resolve=>{
      const processHandle=spawn("docker",args,{
        stdio:["ignore","pipe","pipe"],windowsHide:true,shell:false,env:environment()
      });
      let settled=false;
      const finish=(result:{code:number|null;error?:string})=>{
        if(settled)return;
        settled=true;clearTimeout(timeout);resolve(result);
      };
      processHandle.stdout.on("data",append);
      processHandle.stderr.on("data",append);
      processHandle.once("error",e=>finish({code:null,error:String(e.message)}));
      processHandle.once("close",code=>finish({code}));
      const timeout=setTimeout(()=>{
        timedOut=true;processHandle.kill("SIGKILL");
      },20000);
    });
    exitCode=result.code;
    if(result.error)output+="\n"+result.error.slice(0,500);
  }finally{
    // A timed-out Docker client must not leave its container running.
    spawnSync("docker",["rm","-f",name],{
      timeout:4000,encoding:"utf8",stdio:"ignore",windowsHide:true,env:environment()
    });
    rmSync(stage,{recursive:true,force:true});
  }
  const testSummary=/^# tests [1-9][0-9]*\s*$/m.test(output);
  return {
    status:!testSummary?"unavailable":timedOut||exitCode!==0?"failed":"passed",
    runner:"docker-node-test-v1",candidateSha256:sha(candidateSource),
    testSha256:sha(testSource),imageId,testsExecuted:testSummary,
    exitCode,timedOut,output:output.slice(0,12000),
    recordedAt:new Date().toISOString()
  };
}

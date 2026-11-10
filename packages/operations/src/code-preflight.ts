/**
 * Parse a proposed single-file replacement without executing it.
 * This is syntax checking, not unit testing, sandboxing or verification of behavior.
 */
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {stripTypeScriptTypes} from "node:module";
import {tmpdir} from "node:os";

export type CodePreflight = {
  status:"passed"|"failed"|"not-evaluated";
  checker:"node-esm-syntax"|"node-typescript-syntax"|"json-parse"|"unsupported";
  replacementSha256:string;
  checkedAt:string;
  testsExecuted:false;
  detail:string;
};
const sha256=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const short=(s:unknown)=>String(s??"").replace(/\x1b\[[0-9;]*m/g,"").slice(0,700);
const make=(status:CodePreflight["status"],checker:CodePreflight["checker"],source:string,detail:string):CodePreflight=>({
  status,checker,replacementSha256:sha256(source),checkedAt:new Date().toISOString(),
  testsExecuted:false,detail:short(detail),
});
const parseNode=(path:string,input:string,checker:CodePreflight["checker"],source:string):CodePreflight=>{
  // Only a fixed, trusted executable with --check. The candidate is never run.
  const proc=spawnSync(process.execPath,["--input-type=module","--check"],{
    input,encoding:"utf8",timeout:3000,maxBuffer:16*1024,windowsHide:true,
    cwd:tmpdir(),
    env:{
      NODE_OPTIONS:"",
      ...(process.platform==="win32"?{
        SystemRoot:process.env.SystemRoot||"",
        TEMP:process.env.TEMP||tmpdir(),
        TMP:process.env.TMP||tmpdir(),
      }:{})
    },
  });
  if(proc.error||proc.signal)return make("not-evaluated",checker,source,
    "Syntaxiscontrole kon niet worden afgerond; geen tests uitgevoerd.");
  if(proc.status!==0)return make("failed",checker,source,
    "Syntaxisfout in "+path+": "+short(proc.stderr||"Node gaf een fout bij --check."));
  return make("passed",checker,source,
    "Syntaxis geaccepteerd. Code niet uitgevoerd; geen tests uitgevoerd.");
};
export function checkCodeSyntax(path:string,replacement:string):CodePreflight{
  if(typeof path!=="string"||typeof replacement!=="string"||
     Buffer.byteLength(replacement,"utf8")>32768)
    throw new Error("Ongeldige code voor syntaxiscontrole");
  const extension=path.split(".").at(-1)?.toLowerCase();
  if(extension==="json"){
    try{JSON.parse(replacement);return make("passed","json-parse",replacement,
      "Geldige JSON. Geen schema, gedrag of tests gecontroleerd.");}
    catch{return make("failed","json-parse",replacement,
      "JSON kan niet worden gelezen; voorstel mag niet worden toegepast.");}
  }
  if(extension==="js")return parseNode(path,replacement,"node-esm-syntax",replacement);
  if(extension==="ts"){
    try{
      const stripped=stripTypeScriptTypes(replacement,{
        mode:"transform",sourceUrl:"candidate.ts"
      });
      return parseNode(path,stripped,"node-typescript-syntax",replacement);
    }catch(error){
      return make("failed","node-typescript-syntax",replacement,
        "TypeScript kon niet worden gelezen: "+short((error as Error).message));
    }
  }
  return make("not-evaluated","unsupported",replacement,
    "Voor dit bestandstype is nog geen syntaxiscontrole beschikbaar. Geen tests uitgevoerd.");
}

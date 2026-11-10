/**
 * Source-anchored local RepoSearch, read-only, with an administrator-owned root.
 * Search hits are candidates and NEVER certified best practices.
 */
import {createHash} from "node:crypto";
import {basename,join,relative,resolve,sep} from "node:path";
import {existsSync,readFileSync,readdirSync,lstatSync,realpathSync} from "node:fs";
export interface RepoHit {
  path:string;line:number;excerpt:string;fileSha256:string;
  keyword:string;review:"candidate-not-verified";
}
export interface RepoSearchResult {
  query:string;rootLabel:string;revision:string|null;
  visitedFiles:number;truncated:boolean;results:RepoHit[];
  note:string;
}
const ALLOWED=/\.(ts|tsx|js|mjs|cjs|jsx|py|md|json|yml|yaml|html|css|sql|sh)$/i;
const SENSITIVE=/(^|[\/._-])(secret|secrets|credential|credentials|password|private|token|tokens|keyfile|id_rsa|auth)([\/._-]|$)/i;
const SKIP=new Set([".git","node_modules",".next","dist","build",".cache","coverage",".venv","vendor"]);
const safeText=(s:string)=>!/\0/.test(s) && !/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(s) &&
  !/\b(?:sk-[A-Za-z0-9_-]{18,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(s);
function revision(root:string):string|null {
  try{
    const head=readFileSync(join(root,".git","HEAD"),"utf8").trim();
    if(/^[0-9a-f]{40}$/.test(head))return head;
    const match=/^ref: (refs\/(?:heads|tags)\/[a-zA-Z0-9/_-]+)$/.exec(head);
    if(!match||match[1].includes(".."))return null;
    const ref=readFileSync(join(root,".git",match[1]),"utf8").trim();
    return /^[0-9a-f]{40}$/.test(ref)?ref:null;
  }catch{return null}
}
export function searchLocalRepository(
  configuredRoot:string,query:string,limits:{maxFiles?:number;maxResults?:number}={},
):RepoSearchResult {
  if(typeof configuredRoot!=="string"||!configuredRoot.trim())throw new Error("repository root not configured");
  if(typeof query!=="string"||!query.trim()||query.length>120||/[\r\n\0]/.test(query))
    throw new Error("invalid repository query");
  const maxFiles=limits.maxFiles??1000,maxResults=limits.maxResults??12;
  if(!Number.isInteger(maxFiles)||maxFiles<1||maxFiles>2000||
     !Number.isInteger(maxResults)||maxResults<1||maxResults>20)throw new Error("invalid search limits");
  const root=realpathSync(resolve(configuredRoot));
  if(!lstatSync(root).isDirectory())throw new Error("repository path is not a directory");
  const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const found:RepoHit[]=[];
  const stack=[root];
  let visitedFiles=0,truncated=false;
  while(stack.length && found.length<maxResults && visitedFiles<maxFiles){
    const dir=stack.pop()!;
    const entries=readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));
    for(const entry of entries){
      if(found.length>=maxResults||visitedFiles>=maxFiles){truncated=true;break}
      if(entry.isSymbolicLink())continue;
      const abs=join(dir,entry.name);
      const rel=relative(root,abs).split(sep).join("/");
      if(rel.startsWith("..")||rel.startsWith("/"))continue;
      if(entry.isDirectory()){
        if(!SKIP.has(entry.name) && !SENSITIVE.test(rel))stack.push(abs);
        continue;
      }
      if(!entry.isFile()||!ALLOWED.test(entry.name)||SENSITIVE.test(rel)||entry.name.startsWith("."))continue;
      const st=lstatSync(abs);
      if(st.size>98304||st.size<=0)continue;
      visitedFiles++;
      let data:string;
      try{data=readFileSync(abs,"utf8")}catch{continue}
      if(!safeText(data)||data.includes("\uFFFD"))continue;
      const lines=data.split(/\r?\n/);
      for(let index=0;index<lines.length;index++){
        if(found.length>=maxResults){truncated=true;break}
        const line=lines[index];
        const lower=line.toLowerCase();
        if(!terms.every(term=>lower.includes(term)))continue;
        const matchAt=Math.min(...terms.map(term=>lower.indexOf(term)));
        const excerpt=line.length>420?line.slice(Math.max(0,matchAt-90),Math.max(0,matchAt-90)+420):line;
        if(!safeText(excerpt))continue;
        found.push({path:rel,line:index+1,excerpt,fileSha256:createHash("sha256").update(data).digest("hex"),
          keyword:query,review:"candidate-not-verified"});
      }
    }
  }
  if(stack.length||visitedFiles>=maxFiles)truncated=true;
  found.sort((a,b)=>a.path.localeCompare(b.path)||a.line-b.line);
  return {query,rootLabel:basename(root),revision:revision(root),visitedFiles,truncated,results:found,
    note:"Text matches only. Each hit has a file hash and line number; no tests, licence or semantic correctness have been confirmed."};
}

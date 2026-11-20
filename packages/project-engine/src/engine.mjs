// EAI Work Project Engine: read-only, bounded, deterministic.
import {lstat,readdir,readFile,mkdir,writeFile} from "node:fs/promises";
import {join,relative,resolve,dirname,sep} from "node:path";
import {pathToFileURL} from "node:url";
import {spawnSync} from "node:child_process";
const EXCLUDE=new Set([".git","node_modules",".next",".venv","venv","__pycache__","coverage"]);
const SECRET=/(^|\/)(?:\.env(?:\..+)?|id_(?:rsa|ed25519)|[^/]+\.(?:pem|p12|pfx)|credentials?\.(?:json|ya?ml)|secrets?\.(?:json|ya?ml))$/i;
const CODE=/\.(?:mjs|cjs|js|jsx|tsx|ts|py|php|html?|css|vue|svelte)$/i;
const DOC=/\.(?:pdf|md|txt|docx?|pptx?|xlsx?)$/i;
const JS=/\.(?:mjs|cjs|js)$/i;
const PY=/\.py$/i;
const error=(s)=>{throw new Error(s)};
const existsDir=async(s)=>{try{return (await lstat(s)).isDirectory();}catch{return false}};
const posix=(p)=>p.split(sep).join("/");
export async function inventory(folder,goal="site"){
 if(!["site","app","code","docs"].includes(goal))error("Unsupported goal");
 const root=resolve(folder);
 if(!await existsDir(root))error("Explicit project directory is required");
 const files=[],skipped=[],stack=[root];let totalBytes=0,scannedEntries=0;
 while(stack.length){
  if(stack.length>5000)error("Project has too many directories for this pilot");
  const dir=stack.pop();
  const entries=(await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
  scannedEntries+=entries.length;
  if(scannedEntries>20000)error("Project has too many entries for this pilot");
  for(const entry of entries){
   const abs=join(dir,entry.name),p=posix(relative(root,abs)),st=await lstat(abs);
   if(st.isSymbolicLink()){skipped.push({path:p,reason:"symlink"});continue}
   if(st.isDirectory()){if(EXCLUDE.has(entry.name)){skipped.push({path:p,reason:"dependency-or-cache"});continue}stack.push(abs);continue}
   if(!st.isFile()){skipped.push({path:p,reason:"non-regular"});continue}
   if(files.length>=2500)error("Project has too many files for this pilot");
   totalBytes+=st.size;if(totalBytes>48*1024*1024)error("Project exceeds the pilot size limit");
   files.push({path:p,size:st.size});
  }
 }
 files.sort((a,b)=>a.path.localeCompare(b.path));
 const paths=files.map(x=>x.path),sensitivePaths=paths.filter(x=>SECRET.test(x));
 let manifest={},manifestError=null;
 if(files.some(x=>x.path==="package.json"&&x.size<=100000)){
  try{const x=JSON.parse(await readFile(join(root,"package.json"),"utf8"));if(x&&typeof x==="object"&&!Array.isArray(x))manifest=x;else manifestError="Invalid project manifest"}catch{manifestError="Project manifest unreadable"}
 }
 const dependencies=manifest.dependencies&&typeof manifest.dependencies==="object"&&!Array.isArray(manifest.dependencies)?Object.keys(manifest.dependencies):[];
 const scriptNames=manifest.scripts&&typeof manifest.scripts==="object"&&!Array.isArray(manifest.scripts)?Object.keys(manifest.scripts).slice(0,15):[];
 const startPaths=["index.html","public/index.html","dist/index.html","build/index.html"].filter(x=>paths.includes(x));
 const classification={
  kind:paths.includes("package.json")?"JavaScript / Node.js":paths.some(x=>x.endsWith(".py"))?"Python":paths.some(x=>x.endsWith(".html"))?"HTML website":"Files / documents",
  framework:["next","vite","react","vue","svelte","astro","express"].find(x=>dependencies.includes(x))||null,
  startPaths,hasReadme:paths.some(x=>/^readme(?:\.md)?$/i.test(x)),
  hasIgnore:paths.includes(".gitignore"),hasLicense:paths.some(x=>/^licen[cs]e(?:\.md|\.txt)?$/i.test(x)),
  scriptNames,dependencyNames:dependencies.slice(0,40),codeFiles:paths.filter(x=>CODE.test(x)).length,documentFiles:paths.filter(x=>DOC.test(x)).length
 };
 const warnings=[];
 if(sensitivePaths.length)warnings.push("Possible private files found. Review before publishing.");
 if(manifestError)warnings.push(manifestError);
 if(goal==="site"&&!startPaths.length)warnings.push("No standard website entry point found. Custom build steps may still exist.");
 if(paths.length===1&&paths[0].toLowerCase().endsWith(".zip"))warnings.push("Only a ZIP was found. GitHub does not unpack ZIP uploads automatically.");
 if(skipped.length)warnings.push("Some directories or symlinks were skipped.");
 return {schema:"eai-project-engine/inventory-v1",goal,files,skipped:skipped.slice(0,200),count:files.length,totalBytes,sensitivePaths,classification,warnings,source:"repository-checkout",executesProjectCode:false};
}
export async function syntax(folder){
 const root=resolve(folder);
 if(!await existsDir(root))error("Project directory is missing");
 const data=await inventory(root,"code");
 const files=data.files.filter(x=>JS.test(x.path)||PY.test(x.path));
 if(files.length>120)error("Too many syntax candidates for the pilot");
 const results=[];
 for(const f of files){
  if(f.size>2*1024*1024||data.sensitivePaths.includes(f.path)){results.push({path:f.path,status:"skipped"});continue}
  const filename=join(root,f.path);
  const python=PY.test(f.path);
  const binary=python?"python3":process.execPath;
  const args=python?["-I","-c","import ast,pathlib,sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))",filename]:["--check",filename];
  const r=spawnSync(binary,args,{cwd:root,timeout:3000,maxBuffer:64*1024,env:{PATH:process.env.PATH||"/usr/bin:/bin",HOME:"/tmp"},encoding:"utf8"});
  // Bewaar alleen het regelnummersignaal. De foutuitvoer kan projectcode bevatten.
  const stderr=String(r.stderr||"").slice(0,8192);
  const sourceLine=stderr.match(/:(\d+)(?::\d+)?(?=\r?\n|$)/m)||stderr.match(/\bline (\d+)\b/i);
  const line=sourceLine?Number(sourceLine[1]):null;
  results.push({path:f.path,status:r.error||r.signal||r.status===null?"unknown":r.status===0?"syntax-pass":"syntax-fail",line:Number.isSafeInteger(line)&&line>0?line:null});
 }
 return {schema:"eai-project-engine/syntax-v1",files:results,checked:results.length,passed:results.filter(x=>x.status==="syntax-pass").length,failed:results.filter(x=>x.status==="syntax-fail").length,unknown:results.filter(x=>["unknown","skipped"].includes(x.status)).length,executesProjectCode:false,limits:["No package installation or project-defined scripts","No TypeScript, JSX, browser, integration or functionality test"]};
}
export function combine(project,checks){
 if(project?.schema!=="eai-project-engine/inventory-v1"||checks?.schema!=="eai-project-engine/syntax-v1")error("Unexpected worker result");
 const warnings=[...project.warnings];
 if(checks.failed)warnings.push("Syntax errors found in "+checks.failed+" checked files.");
 if(checks.unknown)warnings.push("Some syntax candidates could not be checked.");
 if(project.classification.scriptNames.length)warnings.push("Project-defined scripts were found but not executed.");
 const result={schema:"eai-project-engine/report-v1",status:checks.failed?"needs-fix":"needs-user-review",project,checks,warnings,notProven:["The application works for its intended users","Dependencies are compatible and secure","The code is safe to deploy","Publishing is authorized"],humanDecisions:["Confirm the desired behavior and what may be public","Approve running unknown project scripts separately","Approve repository changes and deployment separately"],writes:false,published:false};
 const zipOnly=project.count===1&&project.files[0]?.path.toLowerCase().endsWith(".zip");
 const next=zipOnly
  ?"Pak het ZIP-bestand uit en zet de losse projectbestanden in de repository. GitHub pakt een geüpload ZIP-bestand niet vanzelf uit."
  :project.sensitivePaths.length
  ?"Controleer eerst de mogelijk vertrouwelijke bestanden en bepaal welke bestanden openbaar mogen worden."
  :checks.failed
  ?"Herstel de vastgestelde syntaxisfouten en voer de controle daarna opnieuw uit."
  :project.goal==="site"&&!project.classification.startPaths.length
  ?"Bepaal welke pagina de website moet openen. Er is nog geen gebruikelijk startbestand aangetroffen."
  :"Bekijk of de gevonden bestanden passen bij jouw doel. Test het belangrijkste gebruik zelf voordat je verder publiceert.";
 const goalLabel={site:"Een website aanbieden",app:"Een toepassing laten werken",code:"Mijn project onderhouden",docs:"Documenten delen"}[project.goal]||project.goal;
 const ownerRepo=String(process.env.GITHUB_REPOSITORY||"");
 const commitSha=String(process.env.GITHUB_SHA||"");
 const hasSource=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(ownerRepo)&&/^[a-f0-9]{40}$/i.test(commitSha);
 const repositoryUrl=hasSource?"https://github.com/"+ownerRepo:null;
 // Namen van projectbestanden zijn onbetrouwbare invoer, ook in een rapport.
 const safeLabel=(value)=>String(value).replace(/([\\`*_{}\[\]()#+.!<>|~-])/g,"\\$1").replace(/\r/g,"\\r").replace(/\n/g,"\\n");
 const fileLink=(p,line)=>{
  const file=String(p||"").slice(0,250);
  const address=hasSource?repositoryUrl+"/blob/"+commitSha+"/"+file.split("/").map(encodeURIComponent).join("/")+(line?"#L"+line:""):null;
  const label=safeLabel(file+(line?" (regel "+line+")":""));
  return address?"["+label+"]("+address+")":label;
 };
 const failures=(checks.files||[]).filter(x=>x.status==="syntax-fail");
 const good=[
  "We konden "+project.count+" "+(project.count===1?"bestand":"bestanden")+" inventariseren.",
  ...(checks.passed?["De syntaxis van "+checks.passed+" "+(checks.passed===1?"JavaScript- of Python-bestand is":"JavaScript- of Python-bestanden is")+" gecontroleerd zonder vastgestelde syntaxisfout."]:[]),
  ...(project.classification.startPaths.length?["Er is een mogelijk startbestand gevonden: "+project.classification.startPaths.map(x=>fileLink(x)).join(", ")]:[]),
  ...(project.classification.hasReadme?["Er staat een README in het project."]:[])
 ];
 const errors=failures.length?failures.map(x=>"- Syntaxisfout in "+fileLink(x.path,x.line)+". De oorzaak moet nog worden onderzocht."):["- "+(checks.checked?"Binnen de gecontroleerde bestanden geen syntaxisfout vastgesteld.":"Er zijn geen ondersteunde codebestanden op syntaxis getest.")];
 const lines=[
  "# EAIgit","",
  "## Dit kun je nu doen","",next,"",
  ...(repositoryUrl?["[Open je repository]("+repositoryUrl+") | [Bekijk je controles]("+repositoryUrl+"/actions)",""]:[]),
  "## Dit gaat goed",...good.map(x=>"- "+x),"",
  "## Gevonden codefouten",...errors,"",
  "## Wat is nog niet getest?",
  "- Of knoppen, berekeningen en andere functies doen wat je bedoelt.",
  "- Of afhankelijkheden veilig zijn en de toepassing goed kan worden gepubliceerd.","",
  "## Verder met je project",
  "[Open EAIgit voor de volgende stap](https://eaimodel.nl/tools/eaigit/)",
  ""
 ];
 return {...result,markdown:lines.join("\n")};
}

const encodeAnnotationProperty=(value)=>String(value||"").replace(/%/g,"%25").replace(/\r/g,"%0D").replace(/\n/g,"%0A").replace(/:/g,"%3A").replace(/,/g,"%2C");
export function syntaxAnnotations(checks){
 if(checks?.schema!=="eai-project-engine/syntax-v1")error("Unexpected syntax result");
 return (checks.files||[]).filter(x=>x.status==="syntax-fail").slice(0,100).map(x=>{
  const path=encodeAnnotationProperty(x.path);
  const line=Number.isSafeInteger(x.line)&&x.line>0?",line="+x.line:"";
  return "::error file="+path+line+",title=EAIgit syntaxis::Syntaxisfout vastgesteld. Open het bestand en controleer de opgegeven regel.";
 });
}

async function put(path,obj){await mkdir(dirname(resolve(path)),{recursive:true});await writeFile(path,JSON.stringify(obj,null,2)+"\n")}
export async function main(args){
 const [mode,...items]=args;
 if(mode==="inventory"){const [folder,goal,out]=items;if(!out)error("Usage: inventory <dir> <goal> <result.json>");await put(out,await inventory(folder,goal));return}
 if(mode==="syntax"){const [folder,out]=items;if(!out)error("Usage: syntax <dir> <result.json>");await put(out,await syntax(folder));return}
 if(mode==="annotate"){const [path]=items;if(!path)error("Usage: annotate <syntax.json>");const checks=JSON.parse(await readFile(path,"utf8"));for(const text of syntaxAnnotations(checks))console.log(text);return}
 if(mode==="report"){const [ip,sp,dir]=items;if(!dir)error("Usage: report <inventory.json> <syntax.json> <out-dir>");const result=combine(JSON.parse(await readFile(ip,"utf8")),JSON.parse(await readFile(sp,"utf8")));await mkdir(dir,{recursive:true});await put(join(dir,"RESULTAAT.json"),{...result,markdown:undefined});await writeFile(join(dir,"ADVIES.md"),result.markdown);return}
 error("Unknown project worker");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){main(process.argv.slice(2)).catch(x=>{console.error("Projectcontrole: "+String(x?.message||x));process.exitCode=1})}

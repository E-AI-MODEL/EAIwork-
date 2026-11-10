/** Read-only comparison and syntax checks for an explicitly selected source file.
 * This module never evaluates or imports user code.
 */
import {spawnSync} from "node:child_process";

export type DiffLine={kind:"same"|"added"|"removed";text:string};
export interface SourceCheck {status:"passed"|"failed"|"not-checked";name:string;note:string}
const maxShown=180;
const supportedJs=/\.js$/;
export function checkCandidate(path:string,source:string):SourceCheck {
  if(path.endsWith(".json")){
    try{JSON.parse(source);return {name:"JSON-formaat",status:"passed",note:"JSON kan worden gelezen. De inhoud is niet inhoudelijk getest."}}
    catch{return {name:"JSON-formaat",status:"failed",note:"Dit voorstel bevat ongeldige JSON."}}
  }
  if(supportedJs.test(path)){
    try{
      // --check only parses. With "-" and --input-type=module imports are NOT executed.
      const result=spawnSync(process.execPath,["--input-type=module","--check","-"],{
        input:source,encoding:"utf8",timeout:3000,maxBuffer:8192,
        windowsHide:true,stdio:["pipe","pipe","pipe"],shell:false,
      });
      return result.status===0&&!result.error?
        {name:"JavaScript-syntaxis",status:"passed",note:"Node.js heeft de syntaxis gelezen. Geen code of tests uitgevoerd."}:
        {name:"JavaScript-syntaxis",status:"failed",note:"Node.js heeft een syntaxisfout gevonden. Geen code uitgevoerd."};
    }catch{
      return {name:"JavaScript-syntaxis",status:"failed",note:"De lokale syntaxiscontrole kon niet worden gestart."};
    }
  }
  return {name:"Statische controle",status:"not-checked",
    note:"Voor dit bestandstype is geen veilige syntaxiscontrole beschikbaar. Tests zijn niet uitgevoerd."};
}
export function compareSource(original:string,replacement:string):{
  lines:DiffLine[];truncated:boolean;added:number;removed:number;unchanged:number
}{
  const a=original.split("\n"),b=replacement.split("\n");
  let rows:DiffLine[]=[];
  if(a.length<=240&&b.length<=240){
    // Bounded LCS, exact line-level diff. No outside diff tool or shell.
    const dp=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
    for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)
      dp[i][j]=a[i]===b[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
    let i=0,j=0;
    while(i<a.length||j<b.length){
      if(i<a.length&&j<b.length&&a[i]===b[j]){rows.push({kind:"same",text:a[i]});i++;j++}
      else if(j<b.length&&(i===a.length||dp[i][j+1]>=dp[i+1][j]))rows.push({kind:"added",text:b[j++]});
      else rows.push({kind:"removed",text:a[i++]});
    }
  }else{
    // Large files: conservative comparison, no claim of minimal diff.
    let front=0;
    while(front<Math.min(a.length,b.length)&&a[front]===b[front])front++;
    let tail=0;
    while(tail<Math.min(a.length,b.length)-front&&a[a.length-1-tail]===b[b.length-1-tail])tail++;
    rows=[
      ...a.slice(0,front).map(text=>({kind:"same" as const,text})),
      ...a.slice(front,a.length-tail).map(text=>({kind:"removed" as const,text})),
      ...b.slice(front,b.length-tail).map(text=>({kind:"added" as const,text})),
      ...a.slice(a.length-tail).map(text=>({kind:"same" as const,text})),
    ];
  }
  const count=(kind:DiffLine["kind"])=>rows.filter(r=>r.kind===kind).length;
  const added=count("added"),removed=count("removed"),unchanged=count("same");
  if(rows.length<=maxShown)return {lines:rows,truncated:false,added,removed,unchanged};
  const context=60;
  return {lines:[...rows.slice(0,context),...rows.slice(-context)],
    truncated:true,added,removed,unchanged};
}

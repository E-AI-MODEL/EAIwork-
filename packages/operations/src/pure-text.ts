/**
 * Browser/edge-safe deterministic adapters shared with the local runner.
 * No filesystem, network, model calls, shell or dynamic code evaluation.
 */
import type {WorkerContract} from "./registry.ts";
export interface LocalAdapter {
  id:string; taskKind:string; run(input:{text:string}):Record<string,unknown>;
}
export const normalize = (input:{text:string}) => {
  const text=input.text.normalize("NFC").replace(/\r\n?/g,"\n").replace(/[ \t]+/g," ").trim();
  return {text,changed:text!==input.text};
};
export const metrics = (input:{text:string})=>({
  text:input.text,
  characters:[...input.text].length,
  words:input.text.trim()?input.text.trim().split(/\s+/u).length:0,
  lines:input.text?input.text.split("\n").length:0,
});
export const composed=(input:{text:string})=>{
  const cleaned=normalize(input);
  return {...metrics({text:cleaned.text}),changed:cleaned.changed};
};
export const safeComposition=(contract:Pick<WorkerContract,"recipe"|"taskKinds"|"modelPolicy"|"testSuite"|"tools"|"requestedPermissions">)=>
  contract.recipe?.kind==="builtin-compose" &&
  JSON.stringify(contract.recipe.steps)===JSON.stringify(["text-normalize","text-metrics"]) &&
  JSON.stringify(contract.taskKinds)===JSON.stringify(["text-inspect"]) &&
  contract.modelPolicy.preferred==="deterministic" &&
  contract.testSuite==="builtin-compose-fixture-v1" &&
  contract.tools.length===0 && contract.requestedPermissions.length===0;
/** Read Markdown link text only; never load or validate a remote resource. */
export const referenceExtract=(input:{text:string})=>{
  const references:Array<{label:string;url:string}>=[];
  let detected=0;
  const pattern=/\[([^\]\r\n]{1,80})\]\((https?:\/\/[^\s)<>]{1,260})\)/g;
  for(const match of input.text.matchAll(pattern)){
    try{
      const url=new URL(match[2]);
      if(!["http:","https:"].includes(url.protocol)||url.username||url.password)continue;
      detected++;
      if(references.length<8)references.push({label:match[1],url:match[2]});
    }catch{continue}
  }
  return {text:input.text,references,detected,truncated:detected>references.length,
    review:"links-not-verified"};
};
export const BUILTINS:Readonly<Record<string,LocalAdapter>>=Object.freeze({
  "text-normalize":{id:"text-normalize",taskKind:"text-normalize",run:normalize},
  "text-metrics":{id:"text-metrics",taskKind:"text-metrics",run:metrics},
  "reference-extract":{id:"reference-extract",taskKind:"reference-extract",run:referenceExtract},
});
export function runPureTextAdapter(kind:string,input:{text:string}):Record<string,unknown>{
  if(!["text-normalize","text-metrics","text-inspect","reference-extract"].includes(kind)||
     !input||typeof input.text!=="string"||input.text.length>12000)
    throw new Error("unsupported pure text input or adapter");
  return kind==="text-inspect"?composed(structuredClone(input)):
    BUILTINS[kind].run(structuredClone(input));
}
export function evaluateComposedFixture(contract:WorkerContract){
  if(contract.id!=="text-inspector"||!safeComposition(contract))
    throw new Error("untrusted fixed worker recipe");
  const cases=[
    {input:{text:"  Hallo  wereld\r\n"},expected:{text:"Hallo wereld",characters:12,words:2,lines:1,changed:true}},
    {input:{text:"Een\nTwee"},expected:{text:"Een\nTwee",characters:8,words:2,lines:2,changed:false}},
    {input:{text:""},expected:{text:"",characters:0,words:0,lines:0,changed:false}},
  ];
  const passed=cases.filter(x=>JSON.stringify(composed(x.input))===JSON.stringify(x.expected)).length;
  return {numerator:passed,denominator:cases.length,metric:"fixture-pass",taskKind:"text-inspect",
    dataset:"builtin-compose-fixture-v1",suiteVersion:"builtin-compose-fixture-v1",
    cohort:"fixed-fixtures",note:"Only this fixed two-step recipe has been tested."};
}

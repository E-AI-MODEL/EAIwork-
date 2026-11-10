/**
 * Human-reviewed model proposals for an EAIwork mission.
 * A model can propose a plan but cannot register, authorize or execute it.
 */
import {createHash} from "node:crypto";
import {localOllamaHost} from "../../gateway/src/ollama-provider.ts";
import {validateMissionPlan,type MissionPlan} from "./missions.ts";

export interface PlanningModel {
  id:string;
  propose(instruction:string):Promise<unknown>;
}
export interface PlanProposal {
  plan:MissionPlan;
  modelId:string;
  sourceSha256:string;
  status:"requires-human-review";
  constraintCoverage:"not-evaluated";
  note:string;
}
const safeId=(v:string)=>v.replace(/[^a-z0-9-]/gi,"-").toLowerCase().replace(/^-+|-+$/g,"").slice(0,50);
export async function proposeMissionPlan(
  sourceInstruction:string,model:PlanningModel,approvedId:string,
):Promise<PlanProposal>{
  if(typeof sourceInstruction!=="string"||!sourceInstruction.trim()||
     sourceInstruction.length>8000)throw new Error("invalid instruction length");
  if(!/^mission-[a-z0-9-]{3,56}$/.test(approvedId))throw new Error("invalid proposal id");
  const raw=await model.propose(sourceInstruction);
  if(!raw || typeof raw!=="object"||Array.isArray(raw))throw new Error("model returned invalid plan");
  const item=raw as Record<string,unknown>;
  if(Object.keys(item).some(k=>!["title","goal","tasks","constraints"].includes(k)))
    throw new Error("model returned unsupported plan fields");
  const plan={id:approvedId,title:item.title,goal:item.goal,sourceInstruction,
    tasks:item.tasks,constraints:item.constraints??[]} as MissionPlan;
  validateMissionPlan(plan);
  return {plan,modelId:model.id,
    sourceSha256:createHash("sha256").update(sourceInstruction).digest("hex"),
    status:"requires-human-review",constraintCoverage:"not-evaluated",
    note:"The model proposal has passed structural checks only. Original prohibitions, approvals, omissions and task suitability require human review. No task has been scheduled."};
}
const schema={
  type:"object",
  properties:{
    title:{type:"string",maxLength:160},
    goal:{type:"string",maxLength:1500},
    tasks:{type:"array",minItems:1,maxItems:16,items:{
      type:"object",properties:{
        id:{type:"string"},title:{type:"string"},taskKind:{type:"string"},
        dependsOn:{type:"array",items:{type:"string"}},effect:{type:"string",enum:["local","external-write","publish","destructive"]},
        input:{type:"object",properties:{text:{type:"string"}},required:["text"],additionalProperties:false},
        textFrom:{type:"string"},
      },required:["id","title","taskKind","dependsOn"],additionalProperties:false,
    }},
    constraints:{type:"array",maxItems:32,items:{
      type:"object",properties:{
        id:{type:"string"},kind:{type:"string",enum:["prohibition","approval","condition","deadline","uncertainty"]},
        quote:{type:"string"},start:{type:"integer"},end:{type:"integer"},
        taskIds:{type:"array",items:{type:"string"}},approverId:{type:"string"},
      },required:["id","kind","quote","start","end","taskIds"],additionalProperties:false,
    }},
  },required:["title","goal","tasks","constraints"],additionalProperties:false,
};
export function localOllamaPlanningModel(config:{model:string;host?:string;timeoutMs?:number}):PlanningModel{
  const host=localOllamaHost(config.host);
  if(typeof config.model!=="string"||!config.model.trim()||config.model.length>120)
    throw new Error("invalid local model");
  const timeout=config.timeoutMs??45000;
  if(!Number.isInteger(timeout)||timeout<1000||timeout>120000)throw new Error("invalid planner timeout");
  return {id:"ollama:"+config.model,
    async propose(sourceInstruction:string):Promise<unknown>{
      const response=await fetch(host+"/api/chat",{
        method:"POST",headers:{"content-type":"application/json"},signal:AbortSignal.timeout(timeout),
        body:JSON.stringify({model:config.model,stream:false,format:schema,options:{temperature:0,num_predict:1400},
          messages:[{role:"user",content:JSON.stringify({
            instruction:"Suggest a minimal task plan. Do not execute tasks. Extract explicit prohibitions, approvals, deadlines and conditions as exact uninterrupted quotes with UTF-16 start/end offsets in sourceInstruction. Never silently discard a restriction. For any external, publication or destructive action include an approval constraint for that exact task. If information is missing, propose only local, non-destructive tasks. Every task uses exactly one of input:{text:string} or textFrom:(dependency task ID). Do not add fields or claim tests have run. Return JSON only.",
            sourceInstruction,
          })}],
        }),
      });
      if(!response.ok)throw new Error("local planner provider HTTP "+response.status);
      const size=Number(response.headers.get("content-length")||0);
      if(size>65536)throw new Error("local planner response too large");
      const reader=response.body?.getReader();
      if(!reader)throw new Error("local planner response unavailable");
      let bytes=0;const chunks:Uint8Array[]=[];
      while(true){
        const result=await reader.read();
        if(result.done)break;
        bytes+=result.value.byteLength;
        if(bytes>65536){await reader.cancel();throw new Error("local planner response too large")}
        chunks.push(result.value);
      }
      let envelope:unknown;
      try{envelope=JSON.parse(Buffer.concat(chunks).toString("utf8"))}
      catch{throw new Error("local planner returned invalid envelope")}
      const content=(envelope as {message?:{content?:unknown}})?.message?.content;
      if(typeof content!=="string"||content.length>64000)throw new Error("local planner returned invalid content");
      try{return JSON.parse(content)}
      catch{throw new Error("local planner returned non-JSON plan")}
    },
  };
}

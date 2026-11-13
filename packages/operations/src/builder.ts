import type {WorkerContract} from "./registry.ts";
export interface ComposedWorkerProposal {
  status:"contract-proposal-only";
  contract:WorkerContract;
  components:readonly ["text-normalize","text-metrics"];
  note:string;
}
/**
 * A tiny genuine Worker Builder using two fixed, already implemented steps.
 * No dynamic code generation, shell, model-supplied tools or permissions.
 */
export function proposeComposedWorker(id:string,name:string):ComposedWorkerProposal {
  if(typeof id!=="string"||!/^[a-z][a-z0-9-]{2,63}$/.test(id))throw new Error("invalid worker id");
  if(typeof name!=="string"||!name.trim()||name.length>120)throw new Error("invalid worker name");
  const components=["text-normalize","text-metrics"] as const;
  return {
    status:"contract-proposal-only",
    contract:{
      id,version:"1.0.0",name:name.trim(),
      specialization:"Local text normalization followed by deterministic word, character and line measurements",
      taskKinds:["text-inspect"],
      inputSchema:{type:"object",properties:{text:{type:"string"}},required:["text"],additionalProperties:false},
      outputSchema:{type:"object",properties:{text:{type:"string"},words:{type:"integer"},
        characters:{type:"integer"},lines:{type:"integer"},changed:{type:"boolean"}},
        required:["text","words","characters","lines","changed"],additionalProperties:false},
      tools:[],requestedPermissions:[],modelPolicy:{preferred:"deterministic"},
      testSuite:"builtin-compose-fixture-v1",stopConditions:["invalid-input","fixture-failure"],
      recipe:{kind:"builtin-compose",steps:[...components]},
    },
    components,
    note:"A fixed composition of two local deterministic operations. Register as a candidate, run server-side fixtures and request a separate human release. RepoSearch code hits are never executed here.",
  };
}

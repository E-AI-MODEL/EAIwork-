import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { cpus, totalmem, platform, arch } from "node:os";
import { fileURLToPath } from "node:url";
import { compareArms, compareScores, selectCases, PILOT_IDS } from "./compare-core.ts";
import { localOllama } from "./runner.ts";
import { validateFixtures } from "./spec.ts";
import type { Task, Gold } from "./spec.ts";

const [mode, destination] = process.argv.slice(2);
if ((mode !== "pilot" && mode !== "full") || !destination)
  throw new Error("Usage: node experiments/decomposition/compare.ts pilot|full result.json");
const folder = new URL("./", import.meta.url);
const get = (path: string) => readFileSync(new URL(path, folder), "utf8");
const taskText = get("tasks.json"), goldText = get("gold.dev.json");
const allTasks: Task[] = JSON.parse(taskText);
if (validateFixtures(allTasks, JSON.parse(goldText)).length)
  throw new Error("DEV fixture is invalid");
const tasks = selectCases(allTasks, mode);
const model = process.env.EAI_DECOMP_MODEL || "";
if (!model || model.length > 160) throw new Error("EAI_DECOMP_MODEL must be specified");
const checkpoint = new Date().toISOString();
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

let modelDigest: string | null = null;
try {
  const response = await fetch("http://127.0.0.1:11434/api/tags",{signal:AbortSignal.timeout(10000)});
  if (response.ok) {
    const payload = await response.json() as { models?: Array<{name?:string,model?:string,digest?:string}> };
    modelDigest = payload.models?.find(item => item.name === model || item.model === model)?.digest || null;
  }
} catch { /* absent model metadata is recorded as absent, not invented */ }

const started = Date.now();
// Important: do not load the contents of the gold labels into any model prompt.
// The model runner receives Task objects only; gold is used in a separate stage.
const predictions = await compareArms(tasks, localOllama(model));
const elapsed = Date.now() - started;
const byId = new Map((JSON.parse(goldText) as Gold[]).map(item => [item.id, item]));
const gold = tasks.map(task => {
  const item = byId.get(task.id);
  if (!item) throw new Error("missing gold for " + task.id);
  return item;
});
const scores = compareScores(tasks, gold, predictions);
const artifact = {
  experiment:"decomposition-dev-v1", mode, status:"completed", model,
  model_digest:modelDigest, dataset_is_blind:false,
  exact_quote_scoring_not_semantic_validation:true,
  worker_execution_tested:false,
  cases:tasks.map(({id,domain})=>({id,domain})),
  pilot_ids:mode==="pilot"?PILOT_IDS:undefined,
  tasks_sha256:sha256(taskText),gold_sha256:sha256(goldText),
  generated_at:checkpoint,
  runtime:{node:process.version,platform:platform(),arch:arch(),
    cpu_count:cpus().length,memory_bytes:totalmem(),
    elapsed_ms:elapsed,
    model_request_timeout_ms:Number(process.env.EAI_DECOMP_TIMEOUT_MS || 120000),
    max_output_tokens_per_call:Number(process.env.EAI_DECOMP_MAX_OUTPUT_TOKENS || 750)},
  notes:[
    "These visible synthetic DEV fixtures are not a blinded holdout.",
    "These four arms measure extraction, not EAIwork agent/worker execution.",
    "C is agreement-based; D has the same asserted spans as C plus proposals that remain hypotheses.",
    "A/B use one call, C uses two, D uses three: token and runtime budgets are unequal.",
    "Invalid/time-out model outputs are reported separately; source string match is not semantic entailment.",
    "Token count is observed usage, not financial cost; local inference billing was not measured."
  ],
  scores,predictions
};
writeFileSync(destination, JSON.stringify(artifact,null,2)+"\n", {flag:"wx",mode:0o600});
for(const arm of ["A","B","C","D"] as const) {
  const m = scores[arm] as {validCases:number,failedCases:number,matchedSpans:number,
    expectedGoldSpans:number,critical_constraint_recall_on_valid:number|null,total_calls:number,
    input_tokens:number,output_tokens:number,elapsed_ms:number};
  console.log(arm,JSON.stringify({valid:m.validCases,failed:m.failedCases,
    matched:m.matchedSpans,gold:m.expectedGoldSpans,
    critical_recall:m.critical_constraint_recall_on_valid,
    calls:m.total_calls,input_tokens:m.input_tokens,output_tokens:m.output_tokens,
    elapsed_ms:m.elapsed_ms}));
}
console.log("Wrote "+destination+"; model="+model+" digest="+(modelDigest||"unavailable"));

import { readFileSync, writeFileSync } from "node:fs";
import { validateFixtures, scoreRun } from "./spec.ts";
import type { Task, Gold, Prediction } from "./spec.ts";
import { runSuite, localOllama } from "./runner.ts";
import type { Arm } from "./runner.ts";
const root = new URL("./", import.meta.url);
const load = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const tasks: Task[] = load("tasks.json");
const [command, ...args] = process.argv.slice(2);
const usage = "Usage: node experiments/decomposition/cli.ts validate | run A|B|C|D output.json | score predictions.json report.json";
if (command === "validate") {
  const g: Gold[] = load("gold.dev.json");
  const errors = validateFixtures(tasks,g);
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
  else console.log("DEV suite valid: " + tasks.length + " tasks, " + g.reduce((n,x)=>n+x.spans.length,0) + " annotated spans");
} else if (command === "run") {
  const [arm,file] = args as [Arm,string];
  if (!["A","B","C","D"].includes(arm) || !file) throw new Error(usage);
  // Deliberately do not load the gold file in the model-run branch.
  const rows = await runSuite(tasks,arm,localOllama(process.env.EAI_DECOMP_MODEL || ""));
  writeFileSync(file, JSON.stringify({arm,model:process.env.EAI_DECOMP_MODEL,contract:"dev-span-anchor-v1",
     results:rows},null,2)+"\n",{flag:"wx",mode:0o600});
  console.log("Wrote " + file + ": " + rows.filter(r=>!r.failure).length + "/30 structurally valid outputs");
} else if (command === "score") {
  const [infile,outfile] = args;
  if (!infile || !outfile) throw new Error(usage);
  const input = JSON.parse(readFileSync(infile,"utf8")) as {arm:string,results:Prediction[]};
  const metrics = scoreRun(tasks,load("gold.dev.json"),input.results);
  writeFileSync(outfile,JSON.stringify({arm:input.arm,metrics},null,2)+"\n",{flag:"wx",mode:0o600});
  console.log(JSON.stringify({arm:input.arm,valid:metrics.validCases,failed:metrics.failedCases,
    precision:metrics.precisionOnValid,recall:metrics.recallOnValid,coverage:metrics.coverageOfGold},null,2));
} else throw new Error(usage);

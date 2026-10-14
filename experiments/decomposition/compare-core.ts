import type { Task, Gold, Prediction } from "./spec.ts";
import type { Arm, ModelCall } from "./runner.ts";
import { runSuite } from "./runner.ts";
import { scoreRun, validateFixtures } from "./spec.ts";

export const ARMS: readonly Arm[] = ["A", "B", "C", "D"];
// One publicly visible DEV case per domain. Not a blind, independent holdout.
export const PILOT_IDS = ["edu03", "fin01", "dev01", "ops03", "gov02", "res05"] as const;

export function selectCases(all: Task[], mode: "pilot" | "full"): Task[] {
  if (mode === "full") return [...all];
  const lookup = new Map(all.map(t => [t.id, t]));
  return PILOT_IDS.map(id => {
    const task = lookup.get(id);
    if (!task) throw new Error("missing DEV case " + id);
    return task;
  });
}

/**
 * Rotates arm order by case so all arms see the same source input but do not
 * always get the cold-start/warm-cache advantage. Only TEST annotations are sent.
 */
export async function compareArms(tasks: Task[], modelCall: ModelCall): Promise<Record<Arm, Prediction[]>> {
  const outputs: Record<Arm, Prediction[]> = { A: [], B: [], C: [], D: [] };
  for (const [index, task] of tasks.entries()) {
    const shift = index % ARMS.length;
    const order = [...ARMS.slice(shift), ...ARMS.slice(0, shift)];
    for (const arm of order) {
      const result = await runSuite([task], arm, modelCall);
      outputs[arm].push(result[0]);
    }
  }
  return outputs;
}

export function compareScores(tasks: Task[], gold: Gold[], predictions: Record<Arm, Prediction[]>) {
  const fixtureErrors = validateFixtures(tasks, gold, tasks.length);
  if (fixtureErrors.length) throw new Error("invalid subset: " + fixtureErrors.join("; "));
  const summary: Record<string, unknown> = {};
  for (const arm of ARMS) {
    const metrics = scoreRun(tasks, gold, predictions[arm], tasks.length);
    const critical = (["prohibition","condition","approval"] as const)
      .map(kind => metrics.byKind[kind]).reduce((x,m) => ({
        tp: x.tp + m.tp, fp: x.fp + m.fp, fn: x.fn + m.fn
      }), {tp:0,fp:0,fn:0});
    const n = critical.tp + critical.fn;
    summary[arm] = {
      ...metrics,
      critical_constraint_recall_on_valid: n ? critical.tp / n : null,
      critical_constraint_false_positives: critical.fp,
      human_adjudication_required: true
    };
  }
  return summary;
}

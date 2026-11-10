import type { OpsState, QualityMeasurement } from "./registry.ts";
export interface DriftSignal {
  status: "not-measured" | "not-comparable" | "insufficient-samples" | "stable" | "declined" | "improved";
  workerId: string;
  metric: string;
  baseline?: number;
  latest?: number;
  changePoints?: number;
  baselineRef?: string;
  latestRef?: string;
  reason: string;
}
/**
 * Detect a repeatable change on a comparable evaluation cohort.
 * This is a *signal*, not statistical proof or a worker repair verdict.
 */
export function driftSignals(
  state: OpsState, workerId: string, opts: { minSamples?: number; thresholdPoints?: number } = {},
): DriftSignal[] {
  const minSamples=opts.minSamples??20, threshold=opts.thresholdPoints??10;
  if (!Number.isInteger(minSamples)||minSamples<1 || !Number.isFinite(threshold)||threshold<=0) throw new Error("invalid drift policy");
  const m=state.measurements.filter(v=>v.workerId===workerId);
  if (!m.length) return [{status:"not-measured",workerId,metric:"all",reason:"No recorded evaluations"}];
  const groups=new Map<string,QualityMeasurement[]>();
  for(const x of m){
    const key=[x.version,x.taskKind,x.metric,x.dataset,x.suiteVersion,x.cohort].join("|");
    groups.set(key,[...(groups.get(key)??[]),x]);
  }
  return [...groups.values()].map(group=>{
    group.sort((a,b)=>a.measuredAt.localeCompare(b.measuredAt));
    const [baseline]=group,latest=group[group.length-1];
    const basic={workerId,metric:baseline.metric};
    if(group.length<2)return {...basic,status:"not-comparable",reason:"Only one evaluation for this version and cohort"} as DriftSignal;
    if(baseline.denominator<minSamples||latest.denominator<minSamples)
      return {...basic,status:"insufficient-samples",reason:"Too few cases in baseline or latest evaluation"} as DriftSignal;
    const b=100*baseline.numerator/baseline.denominator, l=100*latest.numerator/latest.denominator,delta=l-b;
    return {...basic,status:delta<=-threshold?"declined":delta>=threshold?"improved":"stable",
      baseline:b,latest:l,changePoints:delta,baselineRef:baseline.evidenceRef,latestRef:latest.evidenceRef,
      reason:"Difference on matching version, task, metric, dataset, suite and cohort; not a causal finding"} as DriftSignal;
  });
}

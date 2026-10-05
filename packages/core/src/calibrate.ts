/** Temperature scaling (Guo et al. 2017) on a probability vector. T > 1 softens, T < 1 sharpens. */
export function temperatureScale(p: Record<string, number>, T: number): Record<string, number> {
  const keys = Object.keys(p);
  const logits = keys.map((k) => Math.log(Math.max(p[k], 1e-9)) / T);
  const m = Math.max(...logits);
  const ex = logits.map((l) => Math.exp(l - m));
  const z = ex.reduce((a, b) => a + b, 0);
  return Object.fromEntries(keys.map((k, i) => [k, ex[i] / z]));
}

/** Fit T on checked answers by minimizing negative log-likelihood over a grid. */
export function fitTemperature(samples: { probabilities: Record<string, number>; truth: string }[]): number {
  let best = 1, bestNll = Infinity;
  for (let T = 0.25; T <= 5.0001; T += 0.05) {
    const nll = samples.reduce((s, x) => s - Math.log(Math.max(temperatureScale(x.probabilities, T)[x.truth] ?? 1e-9, 1e-9)), 0);
    if (nll < bestNll) { bestNll = nll; best = T; }
  }
  return Math.round(best * 100) / 100;
}

export type Route = "accept-as-assumption" | "ask-person";
/** Low confidence, "unknown" winning, or high impact goes to a person. Nothing is ever auto-raised. */
export function route(p: Record<string, number>, impact: "low" | "high", minConfidence = 0.8): Route {
  const [top, conf] = Object.entries(p).sort((a, b) => b[1] - a[1])[0];
  if (top === "unknown" || conf < minConfidence || impact === "high") return "ask-person";
  return "accept-as-assumption";
}

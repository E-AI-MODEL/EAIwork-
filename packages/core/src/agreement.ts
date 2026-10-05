/** Do two independent observers answer the same atom the same way? Proposed stop test for atom size. */
export function agreement(a: Record<string, string>, b: Record<string, string>) {
  const ids = Object.keys(a).filter((k) => k in b);
  const disagreements = ids.filter((k) => a[k] !== b[k]);
  const n = ids.length;
  const po = n ? (n - disagreements.length) / n : 0;
  const cats = [...new Set(ids.flatMap((k) => [a[k], b[k]]))];
  let pe = 0;
  for (const c of cats) {
    const pa = ids.filter((k) => a[k] === c).length / (n || 1);
    const pb = ids.filter((k) => b[k] === c).length / (n || 1);
    pe += pa * pb;
  }
  const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe);
  return { n, percent: po, kappa: n ? kappa : NaN, disagreements };
}

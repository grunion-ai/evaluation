const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];

export const tCrit = (df) => {
  if (df <= 30) return T95[Math.max(1, df) - 1];
  if (df >= 120) return 1.96;
  return 2.042 - ((df - 30) / 90) * (2.042 - 1.96);
};

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export const sem = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance / xs.length);
};

export const caseMeans = (rows) => {
  const byCase = {};
  for (const r of rows) if (r.status === 'ok') (byCase[r.case] ??= []).push(r.value);
  return Object.fromEntries(Object.entries(byCase).map(([id, vs]) => [id, mean(vs)]));
};

export const pairedDiff = (baseline, candidate) => {
  const diffs = Object.keys(baseline).filter((id) => id in candidate).map((id) => candidate[id] - baseline[id]);
  if (!diffs.length) return { n: 0, mean: null, sem: null, ci: null };
  const m = mean(diffs);
  const se = sem(diffs);
  const half = tCrit(diffs.length - 1) * se;
  return { n: diffs.length, mean: m, sem: se, ci: [m - half, m + half] };
};

export const passAtK = (p, k) => 1 - (1 - p) ** k;
export const passHatK = (p, k) => p ** k;

export const noiseFloor = (runA, runA2) => {
  const d = pairedDiff(runA, runA2);
  return d.n ? Math.max(Math.abs(d.ci[0]), Math.abs(d.ci[1])) : null;
};

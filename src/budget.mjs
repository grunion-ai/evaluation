import { mean } from './stats.mjs';

export const HEADROOM_PCT = 90;

export const selectCases = (cases, size) =>
  cases
    .filter((c) => size.heldout || c.spec.split !== 'heldout')
    .sort((a, b) => a.spec.id.localeCompare(b.spec.id))
    .slice(0, size.cases)
    .map((c) => ({ ...c, spec: { ...c.spec, trials: size.trials } }));

export const perTrialTokens = (runs) =>
  mean(runs.flatMap((r) => r.results).filter((r) => r.metric === 'tokens' && r.status === 'ok').map((r) => r.value));

export const estimateTokens = ({ cases, arms, perTrial, perJudgeVote = 0, votes = 3 }) => {
  if (perTrial === null) return null;
  const perArm = cases.reduce((sum, { spec }) => {
    const judged = (spec.checks ?? []).filter((c) => c.judge).length;
    return sum + spec.trials * (perTrial + judged * votes * perJudgeVote);
  }, 0);
  return arms * perArm;
};

export const tokensPerPercent = ({ tokens, before, after }) => (after > before ? tokens / (after - before) : null);

export const allowance = ({ rate, caps }) => {
  const limits = [rate?.fiveHour && rate.fiveHour * caps.fiveHourPct, rate?.weekly && rate.weekly * caps.weeklyPct].filter(Boolean);
  return limits.length ? Math.min(...limits) : null;
};

const WINDOWS = [['fiveHour', 'fiveHourPct', '5-hour'], ['weekly', 'weeklyPct', 'weekly']];

export const guard = ({ size, estimate, rate, used, caps }) => {
  const known = WINDOWS.filter(([key]) => rate?.[key]);
  if (estimate === null || !known.length) {
    return size === 'small'
      ? { ok: true, uncalibrated: true, reasons: [], projected: {} }
      : { ok: false, uncalibrated: true, reasons: [`no token estimate or calibration yet; a ${size} run needs a small run first`], projected: {} };
  }
  const reasons = [];
  const projected = {};
  for (const [key, pct, label] of known) {
    projected[pct] = estimate / rate[key];
    if (projected[pct] > caps[pct]) reasons.push(`${label} window: run needs ${projected[pct].toFixed(1)}%, cap is ${caps[pct]}%`);
    if ((used[pct] ?? 0) + projected[pct] > HEADROOM_PCT) reasons.push(`${label} window: no headroom, ${used[pct]}% used plus ${projected[pct].toFixed(1)}% passes ${HEADROOM_PCT}%`);
  }
  return { ok: reasons.length === 0, uncalibrated: false, reasons, projected };
};

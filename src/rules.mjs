export const HALF_LIFE = 30;
export const HORIZON_HALF_LIVES = 3;
export const MIN_WEIGHTED = 20;
export const CHANGE_N = 30;
export const TRACKS = ['interactive', 'automated'];

const COUNTS = ['checked', 'exempt', 'waivers', 'exceptions'];
const round3 = (n) => Math.round(n * 1000) / 1000;
const total = (rows, key) => rows.reduce((n, r) => n + (r[key] ?? 0), 0);

export const ruleRows = (runs) => {
  const latest = new Map();
  for (const run of [...runs].sort((a, b) => String(a.header.startedAt).localeCompare(String(b.header.startedAt)))) {
    for (const r of run.results) if (r.checked !== undefined) latest.set(`${r.case}\n${r.metric}`, r);
  }
  return [...latest.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
};

export const weightedRate = (rows, { halfLife = HALF_LIFE, min = MIN_WEIGHTED } = {}) => {
  const scored = rows.filter((r) => COUNTS.some((k) => r[k])).slice(-halfLife * HORIZON_HALF_LIVES);
  let weighted = 0;
  let hits = 0;
  scored.forEach((r, i) => {
    const w = 0.5 ** ((scored.length - 1 - i) / halfLife);
    weighted += w * r.checked;
    hits += w * r.exceptions;
  });
  const enough = weighted > 0 && weighted >= min;
  return {
    sessions: scored.length,
    ...Object.fromEntries(COUNTS.map((k) => [k, total(scored, k)])),
    weighted: Math.round(weighted * 100) / 100,
    rate: enough ? round3(hits / weighted) : null,
    ...(enough ? {} : { suppressed: true }),
  };
};

export const ruleTrend = (rows, { metrics, since, ...opts } = {}) =>
  TRACKS.flatMap((track) =>
    metrics.map((metric) => {
      const mine = rows.filter((r) => r.track === track && r.metric === metric);
      const now = weightedRate(mine, opts);
      const previous = since ? weightedRate(mine.filter((r) => String(r.at) < since), opts).rate : null;
      const change = previous === null || now.rate === null ? null : round3(now.rate - previous);
      const direction = change === null ? null : change > 0 ? 'rose' : change < 0 ? 'fell' : 'flat';
      return { track, metric, ...now, ...(since ? { previous, change, direction } : {}), head: mine.at(-1)?.harness ?? null };
    }),
  );

const side = (rows, min) => {
  const checked = total(rows, 'checked');
  return { sessions: rows.length, checked, exceptions: total(rows, 'exceptions'), waivers: total(rows, 'waivers'), rate: checked >= min && checked > 0 ? round3(total(rows, 'exceptions') / checked) : null, head: rows.at(-1)?.harness ?? null };
};

export const ruleChange = (rows, sha, { metrics, n = CHANGE_N, min = MIN_WEIGHTED, at } = {}) => {
  const ran = rows.filter((r) => String(r.harness ?? '').startsWith(sha));
  const anchor = at ?? ran.map((r) => r.harnessAt).sort()[0];
  if (!anchor) throw new Error(`no session ran on ${sha}; pass --at with the commit time`);
  const stamp = (ts) => new Date(ts).toISOString();
  const results = TRACKS.flatMap((track) =>
    metrics.map((metric) => {
      const mine = rows.filter((r) => r.track === track && r.metric === metric && r.checked > 0 && r.harnessAt);
      const before = side(mine.filter((r) => stamp(r.harnessAt) < stamp(anchor)).slice(-n), min);
      const after = side(mine.filter((r) => stamp(r.harnessAt) >= stamp(anchor)).slice(0, n), min);
      const known = before.rate !== null && after.rate !== null;
      const delta = known ? round3(after.rate - before.rate) : null;
      return { track, metric, before, after, delta, verdict: !known ? 'insufficient' : delta > 0 ? 'worse' : delta < 0 ? 'better' : 'flat' };
    }),
  );
  return { harness: ran[0]?.harness ?? sha, at: anchor, n, metrics: results };
};

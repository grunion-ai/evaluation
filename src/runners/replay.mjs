const COUNTS = ['checked', 'exempt', 'waivers', 'exceptions'];

const fieldRow = (s, m) => {
  const raw = s[m.field];
  const known = raw !== undefined && raw !== null;
  return { value: known ? Number(raw) : null, status: known ? 'ok' : 'unknown' };
};

const ruleRow = (s, m) => {
  const counts = Object.fromEntries(COUNTS.map((k) => [k, Number(s[m.field]?.[k] ?? 0)]));
  const scored = counts.checked > 0;
  return {
    value: scored ? counts.exceptions / counts.checked : null,
    status: scored ? 'ok' : 'unknown',
    ...counts,
    at: s.at ?? null,
    track: s.track ?? null,
    harness: s.harness ?? null,
    harnessAt: s.harnessAt ?? null,
    ...(s.dims ? { dims: s.dims } : {}),
  };
};

const SCORERS = { field: fieldRow, rule: ruleRow };

export const replay = ({ suite, sessions }) =>
  sessions.flatMap((s) =>
    suite.metrics
      .filter((m) => SCORERS[m.scorer])
      .map((m) => ({ case: s.id, metric: m.name, trial: 1, split: 'heldout', ...SCORERS[m.scorer](s, m) })),
  );

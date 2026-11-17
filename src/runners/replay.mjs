export const replay = ({ suite, sessions }) =>
  sessions.flatMap((s) =>
    suite.metrics
      .filter((m) => m.scorer === 'field')
      .map((m) => {
        const raw = s[m.field];
        const known = raw !== undefined && raw !== null;
        return { case: s.id, metric: m.name, trial: 1, value: known ? Number(raw) : null, status: known ? 'ok' : 'unknown', split: 'heldout' };
      }),
  );

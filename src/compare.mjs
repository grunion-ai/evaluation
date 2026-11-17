import { caseMeans, pairedDiff } from './stats.mjs';

export const verdict = ({ diff, floor, direction }) => {
  if (!diff.n) return 'unknown';
  const clearOfZero = diff.ci[0] > 0 || diff.ci[1] < 0;
  if (!clearOfZero || Math.abs(diff.mean) <= floor) return 'noise';
  const gain = direction === 'down' ? -diff.mean : diff.mean;
  return gain > 0 ? 'improved' : 'regressed';
};

export const gate = ({ target, guards }) => {
  if (target === 'regressed' || guards.includes('regressed')) return 'revise';
  if (target === 'improved' && !guards.includes('unknown')) return 'ship';
  return 'hold';
};

export const compareRuns = ({ suite, baseline, candidate, floors = {}, split, untrusted = new Set() }) => {
  const rowsFor = (run, metric) => run.results.filter((r) => r.metric === metric && (!split || r.split === split));
  const metrics = suite.metrics.map((m) => {
    const diff = pairedDiff(caseMeans(rowsFor(baseline, m.name)), caseMeans(rowsFor(candidate, m.name)));
    const role = m.kind === 'judge' && untrusted.has(m.judge) ? 'diagnostic' : m.role;
    return { metric: m.name, role, diff, verdict: verdict({ diff, floor: floors[m.name] ?? 0, direction: m.direction }) };
  });
  const target = metrics.find((m) => m.role === 'target');
  const guards = metrics.filter((m) => m.role === 'guard').map((m) => m.verdict);
  return { metrics, gate: gate({ target: target ? target.verdict : 'unknown', guards }) };
};

export const comparable = (run) => (run.header.partial ? `run ${run.header.runId} is partial and stays out of comparisons` : null);

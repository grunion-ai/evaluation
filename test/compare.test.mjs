import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, gate } from '../src/compare.mjs';

const diff = (mean, half = 0.01, n = 20) => ({ n, mean, sem: half / 1.96, ci: [mean - half, mean + half] });

test('a gain past the floor with an interval clear of zero is improved', () => {
  assert.equal(verdict({ diff: diff(0.2), floor: 0.05, direction: 'up' }), 'improved');
});

test('a lower-is-better metric that rises is regressed', () => {
  assert.equal(verdict({ diff: diff(0.2), floor: 0.05, direction: 'down' }), 'regressed');
  assert.equal(verdict({ diff: diff(-0.2), floor: 0.05, direction: 'down' }), 'improved');
});

test('a delta inside the floor is noise', () => {
  assert.equal(verdict({ diff: diff(0.03), floor: 0.05, direction: 'up' }), 'noise');
});

test('an interval that crosses zero is noise', () => {
  assert.equal(verdict({ diff: diff(0.2, 0.3), floor: 0.05, direction: 'up' }), 'noise');
});

test('no shared cases is unknown, never noise', () => {
  assert.equal(verdict({ diff: { n: 0, mean: null, sem: null, ci: null }, floor: 0, direction: 'up' }), 'unknown');
});

test('gate ships only when the target improves and no guard regresses', () => {
  assert.equal(gate({ target: 'improved', guards: ['noise', 'improved'] }), 'ship');
  assert.equal(gate({ target: 'improved', guards: ['regressed'] }), 'revise');
  assert.equal(gate({ target: 'noise', guards: ['noise'] }), 'hold');
  assert.equal(gate({ target: 'regressed', guards: [] }), 'revise');
  assert.equal(gate({ target: 'improved', guards: ['unknown'] }), 'hold');
});

test('compareRuns pairs by case, gates on the target and demotes an untrusted judge metric', async () => {
  const { compareRuns } = await import('../src/compare.mjs');
  const suite = { metrics: [
    { name: 'quality', kind: 'judge', judge: 'j', direction: 'up', role: 'target' },
    { name: 'seconds', kind: 'code', direction: 'down', role: 'guard' },
  ] };
  const rows = (quality, seconds) => Array.from({ length: 12 }, (_, i) => [
    { case: `c${i}`, metric: 'quality', value: quality(i), status: 'ok' },
    { case: `c${i}`, metric: 'seconds', value: seconds(i), status: 'ok' },
  ]).flat();
  const baseline = { results: rows((i) => (i % 4 === 0 ? 1 : 0), (i) => 10 + (i % 3)) };
  const candidate = { results: rows((i) => (i % 4 === 3 ? 0 : 1), (i) => 10 + ((i + 1) % 3)) };
  const out = compareRuns({ suite, baseline, candidate });
  assert.equal(out.metrics[0].verdict, 'improved');
  assert.equal(out.metrics[1].verdict, 'noise');
  assert.equal(out.gate, 'ship');
  const held = compareRuns({ suite, baseline, candidate, untrusted: new Set(['j']) });
  assert.equal(held.metrics[0].role, 'diagnostic');
  assert.equal(held.gate, 'hold');
});

test('a partial run is refused by comparePair', async () => {
  const { comparable } = await import('../src/compare.mjs');
  assert.equal(comparable({ header: { partial: true, runId: 'r1' } }), 'run r1 is partial and stays out of comparisons');
  assert.equal(comparable({ header: { runId: 'r2' } }), null);
});

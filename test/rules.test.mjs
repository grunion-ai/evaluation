import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HALF_LIFE, HORIZON_HALF_LIVES, MIN_WEIGHTED, ruleRows, weightedRate, ruleTrend, CHANGE_N, ruleChange } from '../src/rules.mjs';

const cli = join(import.meta.dirname, '..', 'src', 'cli.mjs');
const day = (d) => `2026-11-${String(d).padStart(2, '0')}T10:00:00Z`;
const row = (id, d, exceptions, checked = 4, over = {}) => ({ type: 'result', case: id, metric: 'response', trial: 1, value: checked ? exceptions / checked : null, status: checked ? 'ok' : 'unknown', checked, exempt: 0, waivers: 0, exceptions, at: day(d), track: 'interactive', harness: 'aaa', harnessAt: day(1), ...over });
const run = (runId, startedAt, results) => ({ header: { runId, startedAt }, results });

test('the trial half-life and its guards are named constants', () => {
  assert.deepEqual([HALF_LIFE, HORIZON_HALF_LIVES, MIN_WEIGHTED], [30, 3, 20]);
});

test('rule rows come from every run in session order, and a later run replaces a session scored earlier', () => {
  const rows = ruleRows([
    run('r2', day(21), [row('s1', 10, 0), row('s3', 12, 1)]),
    run('r1', day(20), [row('s2', 11, 2), row('s1', 10, 4), { type: 'result', case: 'x', metric: 'completion', value: 1, status: 'ok' }]),
  ]);
  assert.deepEqual(rows.map((r) => [r.case, r.exceptions]), [['s1', 0], ['s2', 2], ['s3', 1]]);
});

test('the weighted rate halves a session per half-life of age and leaves waived and exempt units out', () => {
  const rows = [row('s1', 10, 4), row('s2', 11, 4), row('s3', 12, 0, 4, { waivers: 3, exempt: 2 })];
  const w = weightedRate(rows, { halfLife: 1, min: 1 });
  assert.deepEqual([w.sessions, w.checked, w.exempt, w.waivers, w.exceptions, w.weighted, w.rate], [3, 12, 2, 3, 8, 7, 0.429]);
  const aged = weightedRate([row('s1', 10, 4), row('q', 11, 0, 0), row('s2', 12, 0)], { halfLife: 1, min: 1 });
  assert.deepEqual([aged.sessions, aged.rate], [2, 0.333]);
  const horizon = weightedRate([row('old', 9, 4), row('s1', 10, 0), row('s2', 11, 0), row('s3', 12, 0)], { halfLife: 1, min: 1 });
  assert.deepEqual([horizon.sessions, horizon.rate], [3, 0]);
});

test('a rate with too little weighted evidence is null, never zero', () => {
  const w = weightedRate([row('s1', 10, 1)], { halfLife: 30, min: 20 });
  assert.deepEqual([w.rate, w.suppressed, w.checked], [null, true, 4]);
});

test('the trend reports each metric per track and whether it rose or fell since a given time', () => {
  const rows = [row('i1', 10, 0), row('i2', 11, 0), row('i3', 12, 4), row('a1', 11, 2, 4, { track: 'automated' }), row('o1', 12, 1, 1, { metric: 'outcome' })];
  const trend = ruleTrend(rows, { metrics: ['response', 'outcome'], halfLife: 1, min: 1, since: '2026-11-12T00:00:00Z' });
  assert.deepEqual(trend.map((t) => [t.track, t.metric, t.rate, t.previous, t.change, t.direction]), [
    ['interactive', 'response', 0.571, 0, 0.571, 'rose'],
    ['interactive', 'outcome', 1, null, null, null],
    ['automated', 'response', 0.5, 0.5, 0, 'flat'],
    ['automated', 'outcome', null, null, null, null],
  ]);
  assert.equal(trend[0].head, 'aaa');
});

test('the trend command reads the history and prints the weighted rates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rules-'));
  const counts = (checked, exceptions) => ({ checked, exempt: 0, waivers: 0, exceptions });
  const sessions = Array.from({ length: 12 }, (_, i) => JSON.stringify({ id: `s${i}`, at: day(10 + i), track: 'interactive', harness: 'aaa', harnessAt: day(1), response: counts(4, i % 2 ? 2 : 0), outcome: counts(1, 0), log: counts(1, 0), untyped: counts(0, 0) }));
  writeFileSync(join(dir, 'rows.jsonl'), sessions.join('\n'));
  const replayed = spawnSync('node', [cli, 'replay', 'harness-rules', join(dir, 'rows.jsonl'), '--history', dir, '--run-id', 'r1', '--arm', 'nightly'], { encoding: 'utf8' });
  assert.equal(replayed.status, 0, replayed.stderr);
  const out = spawnSync('node', [cli, 'trend', 'harness-rules', '--history', dir, '--half-life', '2', '--min', '1'], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const report = JSON.parse(out.stdout);
  assert.deepEqual([report.suite, report.halfLife, report.runs], ['harness-rules', 2, 1]);
  const response = report.trend.find((t) => t.track === 'interactive' && t.metric === 'response');
  assert.deepEqual([response.sessions, response.checked, response.exceptions], [6, 24, 6]);
  assert.ok(response.rate > 0.25 && response.rate < 0.5);
  assert.equal(report.trend.find((t) => t.metric === 'untyped' && t.track === 'interactive').rate, null);
});

const on = (id, d, exceptions, sha, shaDay, over = {}) => row(id, d, exceptions, 4, { harness: sha, harnessAt: day(shaDay), ...over });

test('a change comparison is keyed on the harness commit and scores the sessions on each side of it', () => {
  assert.equal(CHANGE_N, 30);
  const rows = [on('b0', 10, 4, 'aaa111', 1), on('b1', 11, 2, 'aaa111', 1), on('b2', 12, 2, 'bbb222', 5), on('a1', 14, 0, 'ccc333', 13), on('a2', 15, 1, 'ccc333', 13), on('a3', 16, 4, 'ddd444', 15), on('x', 14, 4, 'ccc333', 13, { track: 'automated' })];
  const c = ruleChange(rows, 'ccc3', { metrics: ['response'], n: 2, min: 1 });
  assert.deepEqual([c.harness, c.at, c.n], ['ccc333', day(13), 2]);
  assert.deepEqual(c.metrics[0], { track: 'interactive', metric: 'response', before: { sessions: 2, checked: 8, exceptions: 4, waivers: 0, rate: 0.5, head: 'bbb222' }, after: { sessions: 2, checked: 8, exceptions: 1, waivers: 0, rate: 0.125, head: 'ccc333' }, delta: -0.375, verdict: 'better' });
  assert.deepEqual([c.metrics[1].track, c.metrics[1].before.sessions, c.metrics[1].verdict], ['automated', 0, 'insufficient']);
  assert.equal(ruleChange(rows, 'ddd444', { metrics: ['response'], n: 1, min: 1 }).metrics[0].verdict, 'worse');
  assert.equal(ruleChange(rows, 'ccc333', { metrics: ['response'], n: 2, min: 9 }).metrics[0].verdict, 'insufficient');
});

test('a commit no session ran on needs its time, and an unknown one without a time is refused', () => {
  const rows = [on('b1', 11, 4, 'aaa111', 1), on('a1', 14, 0, 'ccc333', 13)];
  assert.throws(() => ruleChange(rows, 'eee555', { metrics: ['response'] }), /no session ran on eee555/);
  const c = ruleChange(rows, 'eee555', { metrics: ['response'], n: 1, min: 1, at: day(12) });
  assert.deepEqual([c.harness, c.metrics[0].before.sessions, c.metrics[0].after.sessions, c.metrics[0].verdict], ['eee555', 1, 1, 'better']);
});

test('the change command prints the comparison for one commit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rules-change-'));
  const counts = (checked, exceptions) => ({ checked, exempt: 0, waivers: 0, exceptions });
  const sessions = Array.from({ length: 8 }, (_, i) => JSON.stringify({ id: `s${i}`, at: day(10 + i), track: 'interactive', harness: i < 4 ? 'aaa111' : 'bbb222', harnessAt: day(i < 4 ? 1 : 13), response: counts(4, i < 4 ? 2 : 0), outcome: counts(1, 0), log: counts(1, 0), untyped: counts(0, 0) }));
  writeFileSync(join(dir, 'rows.jsonl'), sessions.join('\n'));
  assert.equal(spawnSync('node', [cli, 'replay', 'harness-rules', join(dir, 'rows.jsonl'), '--history', dir, '--run-id', 'r1'], { encoding: 'utf8' }).status, 0);
  const out = spawnSync('node', [cli, 'change', 'harness-rules', 'bbb222', '--history', dir, '--n', '4', '--min', '1'], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const response = JSON.parse(out.stdout).metrics.find((m) => m.metric === 'response' && m.track === 'interactive');
  assert.deepEqual([response.before.rate, response.after.rate, response.verdict], [0.5, 0, 'better']);
  assert.equal(spawnSync('node', [cli, 'change', 'harness-rules', 'zzz', '--history', dir], { encoding: 'utf8' }).status, 2);
});

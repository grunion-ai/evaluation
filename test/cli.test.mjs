import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = join(import.meta.dirname, '..', 'src', 'cli.mjs');
const run = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8' });

test('validate passes on the repo as committed', () => {
  const out = run('validate');
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /ok/);
});

test('replay two periods, then compare gates on completion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-'));
  const sessions = (completed, minutes) => Array.from({ length: 12 }, (_, i) => JSON.stringify({ id: `s${i}`, completed: completed(i), activeMinutes: minutes(i), costUsd: 1, toolCalls: 10 })).join('\n');
  writeFileSync(join(dir, 'before.jsonl'), sessions((i) => i % 4 === 0, (i) => 10 + (i % 3)));
  writeFileSync(join(dir, 'after.jsonl'), sessions((i) => i % 4 !== 3, (i) => 10 + ((i + 1) % 3)));
  for (const id of ['before', 'after']) {
    const out = run('replay', 'harness-sessions', join(dir, `${id}.jsonl`), '--history', dir, '--run-id', id, '--arm', id);
    assert.equal(out.status, 0, out.stderr);
  }
  const out = run('compare', 'harness-sessions', 'before', 'after', '--history', dir);
  assert.equal(out.status, 0, out.stderr);
  const report = JSON.parse(out.stdout);
  assert.equal(report.gate, 'ship');
  assert.equal(report.metrics.find((m) => m.metric === 'completion').verdict, 'improved');
  assert.deepEqual(run('runs', 'harness-sessions', '--history', dir).stdout.match(/"runId": "(\w+)"/g).length, 2);
});

test('an unknown command exits 2 with usage', () => {
  const out = run('nope');
  assert.equal(out.status, 2);
  assert.match(out.stderr, /usage/);
});

test('run refuses a medium size before any small run has been measured', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-'));
  const out = run('run', 'skill-added-harness', '--size', 'medium', '--history', dir, '--budget', join(dir, 'calibration.json'));
  assert.equal(out.status, 2);
  assert.match(out.stderr, /budget guard refused/);
  assert.match(out.stderr, /small run first/);
});

test('calibrate-budget stores tokens per percent for the run model, then run refuses a size over its cap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-'));
  mkdirSync(join(dir, 'harness'));
  const header = { type: 'run', schemaVersion: 1, runId: 'small1', suite: 'harness', mode: 'sandbox', arm: 'baseline', startedAt: '2026-01-01T00:00:00Z', variant: { model: 'claude-sonnet-5-5' } };
  const rows = Array.from({ length: 4 }, (_, i) => ({ type: 'result', case: 'c', metric: 'tokens', trial: i + 1, value: 500000, status: 'ok' }));
  writeFileSync(join(dir, 'harness', 'small1.jsonl'), [header, ...rows].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const budget = join(dir, 'calibration.json');
  const cal = run('calibrate-budget', 'harness', 'small1', '--history', dir, '--budget', budget, '--five-hour-before', '10', '--five-hour-after', '14', '--weekly-before', '5', '--weekly-after', '5');
  assert.equal(cal.status, 0, cal.stderr);
  const stored = JSON.parse(readFileSync(budget, 'utf8'))['claude-sonnet-5-5'];
  assert.equal(stored.fiveHour, 500000);
  assert.equal(stored.weekly, undefined);
  const out = run('run', 'skill-added-harness', '--size', 'small', '--history', dir, '--budget', budget, '--five-hour-used', '89');
  assert.equal(out.status, 2);
  assert.match(out.stderr, /headroom/);
});

test('compare refuses a partial run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-'));
  mkdirSync(join(dir, 'harness'));
  for (const [id, partial] of [['a', false], ['b', true]]) {
    const header = { type: 'run', schemaVersion: 1, runId: id, suite: 'harness', mode: 'sandbox', arm: id, startedAt: '2026-01-01T00:00:00Z', variant: {}, partial };
    writeFileSync(join(dir, 'harness', `${id}.jsonl`), JSON.stringify(header) + '\n');
  }
  const out = run('compare', 'harness', 'a', 'b', '--history', dir);
  assert.equal(out.status, 2);
  assert.match(out.stderr, /partial/);
});

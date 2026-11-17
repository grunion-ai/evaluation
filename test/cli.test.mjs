import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
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

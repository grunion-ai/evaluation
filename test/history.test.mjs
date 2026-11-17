import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendRun, readRun, listRuns } from '../src/history.mjs';
import { fingerprint } from '../src/fingerprint.mjs';

const run = (id) => ({
  header: { runId: id, suite: 'harness', mode: 'sandbox', arm: 'baseline', startedAt: '2026-01-01T00:00:00Z', variant: { model: 'm' } },
  results: [{ case: 'a', metric: 'completion', trial: 1, value: 1, status: 'ok' }],
});

test('appendRun writes one header line and one line per result', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hist-'));
  const file = appendRun(dir, run('r1'));
  const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].type, 'run');
  assert.equal(lines[0].schemaVersion, 1);
  assert.equal(lines[0].fingerprint, fingerprint({ model: 'm' }));
  assert.equal(lines[1].type, 'result');
});

test('history is append-only: a run id is never rewritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hist-'));
  appendRun(dir, run('r1'));
  assert.throws(() => appendRun(dir, run('r1')), /exists/);
});

test('readRun and listRuns round-trip, oldest first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hist-'));
  appendRun(dir, { ...run('r2'), header: { ...run('r2').header, startedAt: '2026-02-01T00:00:00Z' } });
  appendRun(dir, run('r1'));
  assert.deepEqual(listRuns(dir, 'harness').map((h) => h.runId), ['r1', 'r2']);
  assert.equal(readRun(dir, 'harness', 'r1').results[0].value, 1);
});

test('fingerprint ignores key order', () => {
  assert.equal(fingerprint({ a: 1, b: { c: 2, d: 3 } }), fingerprint({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
});

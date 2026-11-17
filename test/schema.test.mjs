import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSuite, validateCase, validateExperiment } from '../src/schema.mjs';

const suite = {
  schemaVersion: 1, name: 'backend', kind: 'capability',
  metrics: [
    { name: 'tests_pass', kind: 'code', scorer: 'command', direction: 'up', unit: 'rate', role: 'target' },
    { name: 'review', kind: 'judge', judge: 'code-review', direction: 'up', unit: 'rate', role: 'guard' },
  ],
};

test('a well-formed suite has no errors', () => {
  assert.deepEqual(validateSuite(suite), []);
});

test('suite errors name the field', () => {
  const errs = validateSuite({ ...suite, kind: 'x', metrics: [{ name: 'm', kind: 'judge', direction: 'sideways', unit: 'rate', role: 'guard' }] });
  assert.ok(errs.some((e) => /kind/.test(e)));
  assert.ok(errs.some((e) => /judge/.test(e)));
  assert.ok(errs.some((e) => /direction/.test(e)));
});

test('a suite needs exactly one target metric', () => {
  const errs = validateSuite({ ...suite, metrics: suite.metrics.map((m) => ({ ...m, role: 'guard' })) });
  assert.ok(errs.some((e) => /target/.test(e)));
});

test('a sandbox case needs trials of three or more and a split', () => {
  const ok = { schemaVersion: 1, id: 'fix-bug', mode: 'sandbox', split: 'train', trials: 3, timeoutSeconds: 600, source: 'observed failure', checks: [{ metric: 'tests_pass', command: 'node --test' }] };
  assert.deepEqual(validateCase(ok, suite), []);
  const errs = validateCase({ ...ok, trials: 1, split: 'x', checks: [{ metric: 'nope' }] }, suite);
  assert.ok(errs.some((e) => /trials/.test(e)));
  assert.ok(errs.some((e) => /split/.test(e)));
  assert.ok(errs.some((e) => /nope/.test(e)));
});

test('an experiment has two arms that differ on exactly one axis', () => {
  const ok = { schemaVersion: 1, name: 'x', suite: 'backend', axis: 'model', baseline: { model: 'a', skills: 's1' }, candidate: { model: 'b', skills: 's1' } };
  assert.deepEqual(validateExperiment(ok), []);
  const errs = validateExperiment({ ...ok, candidate: { model: 'b', skills: 's2' } });
  assert.ok(errs.some((e) => /one axis/.test(e)));
});

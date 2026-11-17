import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mean, sem, caseMeans, pairedDiff, passAtK, passHatK, noiseFloor, tCrit } from '../src/stats.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('mean and standard error', () => {
  assert.equal(mean([1, 2, 3]), 2);
  near(sem([1, 2, 3]), 1 / Math.sqrt(3));
  assert.equal(sem([5]), 0);
  assert.equal(mean([]), null);
});

test('caseMeans clusters trials on the case and skips infra failures', () => {
  const rows = [
    { case: 'a', value: 1, status: 'ok' },
    { case: 'a', value: 0, status: 'ok' },
    { case: 'a', value: 0, status: 'infra' },
    { case: 'b', value: 1, status: 'ok' },
  ];
  assert.deepEqual(caseMeans(rows), { a: 0.5, b: 1 });
});

test('pairedDiff uses only cases both runs share', () => {
  const d = pairedDiff({ a: 0.5, b: 1, c: 0 }, { a: 1, b: 1, d: 1 });
  assert.equal(d.n, 2);
  assert.equal(d.mean, 0.25);
  near(d.sem, 0.25);
  near(d.ci[0], 0.25 - 12.706 * 0.25);
  near(d.ci[1], 0.25 + 12.706 * 0.25);
});

test('pairedDiff with no shared cases reports n 0', () => {
  assert.deepEqual(pairedDiff({ a: 1 }, { b: 1 }), { n: 0, mean: null, sem: null, ci: null });
});

test('pass@k and pass^k', () => {
  near(passHatK(0.75, 3), 0.421875);
  near(passAtK(0.75, 3), 0.984375);
});

test('noiseFloor is the outer edge of an A/A interval', () => {
  const floor = noiseFloor({ a: 0.5, b: 1 }, { a: 1, b: 1 });
  near(floor, 0.25 + 12.706 * 0.25);
  assert.equal(noiseFloor({ a: 1, b: 0 }, { a: 1, b: 0 }), 0);
});

test('tCrit widens the interval for small samples and settles at 1.96', () => {
  assert.equal(tCrit(1), 12.706);
  assert.equal(tCrit(10), 2.228);
  assert.equal(tCrit(500), 1.96);
  assert.ok(tCrit(35) > 1.96 && tCrit(35) < 2.042);
});

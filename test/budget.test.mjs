import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { selectCases, perTrialTokens, estimateTokens, guard, tokensPerPercent, allowance } from '../src/budget.mjs';
import { validateSizes } from '../src/schema.mjs';

const sizes = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'sizes.json'), 'utf8'));
const cases = ['d', 'b', 'a', 'c', 'e', 'f'].map((id, i) => ({ spec: { id, split: i % 3 === 0 ? 'heldout' : 'train', trials: 3 } }));

test('sizes.json validates and carries small, medium and large', () => {
  assert.deepEqual(validateSizes(sizes), []);
  assert.deepEqual(Object.keys(sizes.sizes), ['small', 'medium', 'large']);
});

test('validateSizes names a missing cap', () => {
  const errs = validateSizes({ schemaVersion: 1, sizes: { small: { cases: 5, trials: 3, heldout: false, caps: { weeklyPct: 1 } } } });
  assert.ok(errs.some((e) => /fiveHourPct/.test(e)));
});

test('selectCases is deterministic, capped, and keeps held-out cases out of sizes that exclude them', () => {
  const small = selectCases(cases, { cases: 2, trials: 3, heldout: false });
  assert.deepEqual(small.map((c) => c.spec.id), ['a', 'b']);
  const large = selectCases(cases, { cases: 50, trials: 5, heldout: true });
  assert.deepEqual(large.map((c) => c.spec.id), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.ok(large.every((c) => c.spec.trials === 5));
});

test('perTrialTokens averages the tokens rows of past runs and ignores unknowns', () => {
  const runs = [{ results: [
    { metric: 'tokens', value: 1000, status: 'ok' },
    { metric: 'tokens', value: 3000, status: 'ok' },
    { metric: 'tokens', value: null, status: 'infra' },
    { metric: 'completion', value: 1, status: 'ok' },
  ] }];
  assert.equal(perTrialTokens(runs), 2000);
  assert.equal(perTrialTokens([]), null);
});

test('estimateTokens multiplies trials by arms and adds judge votes', () => {
  const picked = [{ spec: { trials: 3, checks: [{ judge: 'j' }, { command: 'x' }] } }, { spec: { trials: 3, checks: [] } }];
  assert.equal(estimateTokens({ cases: picked, arms: 2, perTrial: 1000, perJudgeVote: 100, votes: 3 }), 2 * (6 * 1000 + 3 * 3 * 100));
  assert.equal(estimateTokens({ cases: picked, arms: 2, perTrial: null }), null);
});

test('tokensPerPercent comes from a measured run and refuses a flat reading', () => {
  assert.equal(tokensPerPercent({ tokens: 500000, before: 10, after: 12 }), 250000);
  assert.equal(tokensPerPercent({ tokens: 500000, before: 10, after: 10 }), null);
});

const caps = { fiveHourPct: 10, weeklyPct: 1 };
const rate = { fiveHour: 100000, weekly: 2000000 };

test('guard passes a run inside both caps', () => {
  const out = guard({ size: 'small', estimate: 500000, rate, used: { fiveHourPct: 20, weeklyPct: 5 }, caps });
  assert.equal(out.ok, true);
  assert.deepEqual(out.projected, { fiveHourPct: 5, weeklyPct: 0.25 });
});

test('guard refuses a run over a cap and names the window', () => {
  const out = guard({ size: 'small', estimate: 3000000, rate, used: { fiveHourPct: 0, weeklyPct: 0 }, caps });
  assert.equal(out.ok, false);
  assert.ok(out.reasons.some((r) => /5-hour/.test(r)));
  assert.ok(out.reasons.some((r) => /weekly/.test(r)));
});

test('guard refuses when the window has no headroom left', () => {
  const out = guard({ size: 'small', estimate: 500000, rate, used: { fiveHourPct: 88, weeklyPct: 5 }, caps });
  assert.equal(out.ok, false);
  assert.ok(out.reasons.some((r) => /headroom/.test(r)));
});

test('only a small run may go ahead uncalibrated or with no estimate', () => {
  assert.equal(guard({ size: 'small', estimate: null, rate: null, used: {}, caps }).ok, true);
  assert.equal(guard({ size: 'small', estimate: null, rate: null, used: {}, caps }).uncalibrated, true);
  const medium = guard({ size: 'medium', estimate: null, rate: null, used: {}, caps });
  assert.equal(medium.ok, false);
  assert.ok(medium.reasons.some((r) => /small run/.test(r)));
});

test('allowance is the tighter of the two caps in tokens', () => {
  assert.equal(allowance({ rate, caps }), 1000000);
  assert.equal(allowance({ rate: null, caps }), null);
});

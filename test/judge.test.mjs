import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVerdict, vote, agreement, trusted, judgePrompt, pairwise } from '../src/judge.mjs';

test('parseVerdict reads the verdict tag and nothing else', () => {
  assert.equal(parseVerdict('<thinking>it should FAIL?</thinking><verdict>PASS</verdict>'), 'pass');
  assert.equal(parseVerdict('<verdict> fail </verdict>'), 'fail');
  assert.equal(parseVerdict('<verdict>UNKNOWN</verdict>'), 'unknown');
  assert.equal(parseVerdict('PASS'), 'unknown');
});

test('vote needs two of three', () => {
  assert.equal(vote(['pass', 'pass', 'fail']), 'pass');
  assert.equal(vote(['fail', 'unknown', 'fail']), 'fail');
  assert.equal(vote(['pass', 'fail', 'unknown']), 'unknown');
});

test('agreement reports true positive and true negative rates against human labels', () => {
  const a = agreement([
    { label: 'pass', verdict: 'pass' },
    { label: 'pass', verdict: 'fail' },
    { label: 'fail', verdict: 'fail' },
    { label: 'fail', verdict: 'fail' },
  ]);
  assert.deepEqual(a, { n: 4, tpr: 0.5, tnr: 1 });
});

test('a judge is trusted only when both rates clear the bar on enough labels', () => {
  assert.equal(trusted({ n: 30, tpr: 0.9, tnr: 0.85 }), true);
  assert.equal(trusted({ n: 30, tpr: 0.9, tnr: 0.7 }), false);
  assert.equal(trusted({ n: 5, tpr: 1, tnr: 1 }), false);
});

test('judgePrompt wraps the rubric and the output in tags', () => {
  const p = judgePrompt({ rubric: 'Names the reader.', output: 'Hello team' });
  assert.match(p, /<rubric>\nNames the reader\.\n<\/rubric>/);
  assert.match(p, /<output>\nHello team\n<\/output>/);
  assert.match(p, /<verdict>/);
});

test('pairwise runs both orders and treats a flip as a tie', () => {
  assert.equal(pairwise({ first: 'baseline', second: 'candidate', winner: 'second' }, { first: 'candidate', second: 'baseline', winner: 'first' }), 'candidate');
  assert.equal(pairwise({ first: 'baseline', second: 'candidate', winner: 'first' }, { first: 'candidate', second: 'baseline', winner: 'first' }), 'tie');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replay } from '../src/runners/replay.mjs';
import { runTrial } from '../src/runners/sandbox.mjs';

const suite = {
  name: 'harness',
  metrics: [
    { name: 'completion', kind: 'code', scorer: 'field', field: 'completed', direction: 'up', unit: 'rate', role: 'target' },
    { name: 'active_minutes', kind: 'code', scorer: 'field', field: 'activeMinutes', direction: 'down', unit: 'minutes', role: 'guard' },
  ],
};

test('replay scores each session once per metric', () => {
  const rows = replay({ suite, sessions: [{ id: 's1', completed: true, activeMinutes: 12 }] });
  assert.deepEqual(rows, [
    { case: 's1', metric: 'completion', trial: 1, value: 1, status: 'ok', split: 'heldout' },
    { case: 's1', metric: 'active_minutes', trial: 1, value: 12, status: 'ok', split: 'heldout' },
  ]);
});

test('a missing field is unknown, never zero', () => {
  const rows = replay({ suite, sessions: [{ id: 's2', completed: false }] });
  assert.equal(rows[0].value, 0);
  assert.equal(rows[1].status, 'unknown');
  assert.equal(rows[1].value, null);
});

const makeCase = () => {
  const dir = mkdtempSync(join(tmpdir(), 'case-'));
  mkdirSync(join(dir, 'fixture'));
  mkdirSync(join(dir, 'checks'));
  writeFileSync(join(dir, 'PROMPT.md'), 'Write answer.txt containing 42.');
  writeFileSync(join(dir, 'fixture', 'README.md'), 'starter');
  writeFileSync(join(dir, 'checks', 'check.mjs'), "import { readFileSync } from 'node:fs'; process.exit(readFileSync('answer.txt', 'utf8').trim() === '42' ? 0 : 1);");
  return dir;
};
const spec = { id: 'answer', split: 'train', timeoutSeconds: 5, checks: [{ metric: 'tests_pass', command: 'node checks/check.mjs' }] };

test('runTrial gives the agent the fixture, withholds the checks, then scores', async () => {
  let sawChecks = null;
  const agent = async ({ prompt, cwd, home }) => {
    sawChecks = existsSync(join(cwd, 'checks'));
    assert.match(prompt, /42/);
    assert.equal(readFileSync(join(cwd, 'README.md'), 'utf8'), 'starter');
    assert.notEqual(home, process.env.HOME);
    writeFileSync(join(cwd, 'answer.txt'), '42\n');
    return { transcript: 'done' };
  };
  const { rows, transcript } = await runTrial({ caseDir: makeCase(), spec, trial: 1, arm: {}, agent });
  assert.equal(sawChecks, false);
  assert.equal(transcript, 'done');
  const pass = rows.find((r) => r.metric === 'tests_pass');
  assert.deepEqual({ value: pass.value, status: pass.status, split: pass.split, trial: pass.trial }, { value: 1, status: 'ok', split: 'train', trial: 1 });
  assert.ok(rows.find((r) => r.metric === 'duration_seconds').value >= 0);
});

test('a wrong answer scores 0 with status ok', async () => {
  const agent = async ({ cwd }) => { writeFileSync(join(cwd, 'answer.txt'), '41'); return { transcript: '' }; };
  const { rows } = await runTrial({ caseDir: makeCase(), spec, trial: 2, arm: {}, agent });
  assert.equal(rows.find((r) => r.metric === 'tests_pass').value, 0);
});

test('an agent that throws is an infra failure and a timeout is a timeout', async () => {
  const boom = await runTrial({ caseDir: makeCase(), spec, trial: 1, arm: {}, agent: async () => { throw new Error('spawn ENOENT'); } });
  assert.ok(boom.rows.every((r) => r.status === 'infra' && r.value === null));
  const slow = await runTrial({ caseDir: makeCase(), spec, trial: 1, arm: {}, agent: async () => ({ transcript: '', timedOut: true }) });
  assert.ok(slow.rows.every((r) => r.status === 'timeout'));
});

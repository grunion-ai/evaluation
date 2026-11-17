import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadSuites, loadExperiments, loadJudges } from '../src/repo.mjs';
import { validateSuite, validateCase, validateExperiment } from '../src/schema.mjs';
import { runTrial } from '../src/runners/sandbox.mjs';

const root = join(import.meta.dirname, '..');
const suites = loadSuites(root);
const judges = loadJudges(root);

test('the repo carries the five domains', () => {
  for (const name of ['harness', 'backend', 'frontend', 'writing', 'design']) assert.ok(suites.some((s) => s.suite.name === name), name);
});

test('every suite, case and experiment validates', () => {
  const errs = [
    ...suites.flatMap((s) => [...validateSuite(s.suite), ...s.cases.flatMap((c) => validateCase(c.spec, s.suite))]),
    ...loadExperiments(root).flatMap(validateExperiment),
  ];
  assert.deepEqual(errs, []);
});

test('every judge a suite names has a rubric and a labels file', () => {
  for (const { suite } of suites)
    for (const m of suite.metrics.filter((x) => x.kind === 'judge')) {
      assert.ok(judges[m.judge], `${suite.name} names unknown judge ${m.judge}`);
      assert.ok(existsSync(join(root, 'judges', judges[m.judge].rubric)));
      assert.ok(existsSync(join(root, 'judges', judges[m.judge].labels)));
    }
});

for (const { suite, cases } of suites)
  for (const { dir, spec } of cases.filter((c) => c.spec.mode === 'sandbox')) {
    const commands = spec.checks.filter((c) => c.command).map((c) => c.metric);

    test(`${suite.name}/${spec.id}: the reference solution passes every code check`, async () => {
      const agent = async ({ cwd }) => { cpSync(join(dir, 'solution'), cwd, { recursive: true }); return { transcript: '' }; };
      const { rows } = await runTrial({ caseDir: dir, spec, trial: 1, arm: {}, agent });
      for (const metric of commands) assert.equal(rows.find((r) => r.metric === metric).value, 1, metric);
    });

    test(`${suite.name}/${spec.id}: the untouched fixture fails at least one code check`, async () => {
      const { rows } = await runTrial({ caseDir: dir, spec, trial: 1, arm: {}, agent: async () => ({ transcript: '' }) });
      assert.ok(commands.some((metric) => rows.find((r) => r.metric === metric).value === 0));
    });
  }

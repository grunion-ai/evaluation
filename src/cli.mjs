#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { compareRuns } from './compare.mjs';
import { appendRun, readRun, listRuns } from './history.mjs';
import { agreement, runJudge, trusted } from './judge.mjs';
import { loadExperiments, loadJudges, loadSuites, readJsonl } from './repo.mjs';
import { replay } from './runners/replay.mjs';
import { runTrial } from './runners/sandbox.mjs';
import { validateCase, validateExperiment, validateSuite } from './schema.mjs';
import { caseMeans, noiseFloor } from './stats.mjs';

const root = join(import.meta.dirname, '..');
const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    history: { type: 'string', default: join(root, 'history') },
    'run-id': { type: 'string' },
    arm: { type: 'string', default: 'both' },
    variant: { type: 'string', default: '{}' },
    split: { type: 'string' },
    aa: { type: 'string', multiple: true },
    case: { type: 'string' },
  },
});
const [command, ...args] = positionals;
const print = (value) => console.log(JSON.stringify(value, null, 2));
const fail = (message) => { console.error(message); process.exit(2); };
const suiteNamed = (name) => loadSuites(root).find((s) => s.suite.name === name) ?? fail(`unknown suite ${name}`);
const stamp = () => new Date().toISOString();
const newRunId = (label) => `${stamp().replace(/[:.]/g, '-')}-${label}`;

const askClaude = async ({ prompt, model }) => {
  const out = spawnSync('claude', ['-p', '--model', model], { input: prompt, encoding: 'utf8' });
  if (out.error) throw out.error;
  return out.stdout;
};

const calibration = (name) => {
  const judge = loadJudges(root)[name] ?? fail(`unknown judge ${name}`);
  const file = join(root, 'judges', `${name}.calibration.json`);
  return { judge, file, result: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null };
};

const commands = {
  validate() {
    const errs = [
      ...loadSuites(root).flatMap((s) => [...validateSuite(s.suite), ...s.cases.flatMap((c) => validateCase(c.spec, s.suite))]),
      ...loadExperiments(root).flatMap(validateExperiment),
    ];
    for (const e of errs) console.error(e);
    console.log(errs.length ? `${errs.length} errors` : 'ok');
    process.exit(errs.length ? 1 : 0);
  },

  replay([suiteName, sessionsFile]) {
    const { suite } = suiteNamed(suiteName);
    const header = { runId: flags['run-id'] ?? newRunId('replay'), suite: suite.name, mode: 'replay', arm: flags.arm, startedAt: stamp(), variant: JSON.parse(flags.variant) };
    print({ file: appendRun(flags.history, { header, results: replay({ suite, sessions: readJsonl(sessionsFile) }) }) });
  },

  async run([experimentName]) {
    const experiment = loadExperiments(root).find((e) => e.name === experimentName) ?? fail(`unknown experiment ${experimentName}`);
    const { suite, cases } = suiteNamed(experiment.suite);
    const judges = loadJudges(root);
    const arms = flags.arm === 'both' ? ['baseline', 'candidate'] : [flags.arm];
    for (const armName of arms) {
      const arm = experiment[armName];
      const clash = suite.metrics.find((m) => m.kind === 'judge' && judges[m.judge].model === arm.model);
      if (clash) fail(`judge ${clash.judge} runs on ${arm.model}, the model under test; pin the judge to a different model`);
      const runId = newRunId(`${experiment.name}-${armName}`);
      const startedAt = stamp();
      const results = [];
      for (const { dir, spec } of cases.filter((c) => c.spec.mode === 'sandbox' && (!flags.case || c.spec.id === flags.case))) {
        for (let trial = 1; trial <= spec.trials; trial++) {
          const out = await runTrial({ caseDir: dir, spec, trial, arm: { ...arm, config: arm.config && join(root, arm.config) } });
          const folder = join(root, 'results', runId, spec.id, `trial-${trial}`);
          mkdirSync(folder, { recursive: true });
          writeFileSync(join(folder, 'transcript.txt'), out.transcript ?? '');
          results.push(...out.rows);
          const ran = out.rows.every((r) => r.status === 'ok');
          for (const check of spec.checks.filter((c) => c.judge)) {
            const row = { case: spec.id, metric: check.metric, trial, split: spec.split };
            const file = join(out.workDir, check.output);
            if (!ran) { results.push({ ...row, value: null, status: out.rows[0].status }); continue; }
            if (!existsSync(file)) { results.push({ ...row, value: 0, status: 'ok', evidence: `${check.output} missing` }); continue; }
            const judge = judges[check.judge];
            const graded = await runJudge({
              rubric: readFileSync(join(root, 'judges', judge.rubric), 'utf8'),
              task: readFileSync(join(dir, 'PROMPT.md'), 'utf8'),
              output: readFileSync(file, 'utf8'), model: judge.model, votes: judge.votes, ask: askClaude,
            });
            writeFileSync(join(folder, `${check.judge}.json`), JSON.stringify(graded, null, 2));
            results.push(graded.verdict === 'unknown'
              ? { ...row, value: null, status: 'unknown', evidence: graded.verdicts.join(',') }
              : { ...row, value: graded.verdict === 'pass' ? 1 : 0, status: 'ok', evidence: graded.verdicts.join(',') });
          }
        }
      }
      const header = { runId, suite: suite.name, mode: 'sandbox', arm: armName, experiment: experiment.name, startedAt, finishedAt: stamp(), variant: arm };
      print({ file: appendRun(flags.history, { header, results }) });
    }
  },

  compare([suiteName, baselineId, candidateId]) {
    const { suite } = suiteNamed(suiteName);
    const [baseline, candidate] = [baselineId, candidateId].map((id) => readRun(flags.history, suite.name, id));
    const floors = {};
    if (flags.aa?.length === 2) {
      const [a, a2] = flags.aa.map((id) => readRun(flags.history, suite.name, id));
      for (const m of suite.metrics) {
        const rows = (run) => caseMeans(run.results.filter((r) => r.metric === m.name));
        floors[m.name] = noiseFloor(rows(a), rows(a2)) ?? 0;
      }
    }
    const untrusted = new Set(suite.metrics.filter((m) => m.kind === 'judge' && !calibration(m.judge).result?.trusted).map((m) => m.judge));
    const out = compareRuns({ suite, baseline, candidate, floors, split: flags.split, untrusted });
    print({ suite: suite.name, baseline: baselineId, candidate: candidateId, floors, untrustedJudges: [...untrusted], ...out });
    process.exit(out.gate === 'revise' ? 1 : 0);
  },

  async calibrate([name]) {
    const { judge, file } = calibration(name);
    const labels = readJsonl(join(root, 'judges', judge.labels)).filter((l) => l.split === 'test');
    const rubric = readFileSync(join(root, 'judges', judge.rubric), 'utf8');
    const pairs = [];
    for (const l of labels) pairs.push({ label: l.label, verdict: (await runJudge({ rubric, output: l.output, task: l.task, model: judge.model, votes: judge.votes, ask: askClaude })).verdict });
    const stats = agreement(pairs);
    const result = { judge: name, model: judge.model, at: stamp(), ...stats, trusted: trusted(stats) };
    writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
    print(result);
  },

  runs([suiteName]) {
    print(listRuns(flags.history, suiteName).map(({ runId, arm, mode, startedAt, fingerprint }) => ({ runId, arm, mode, startedAt, fingerprint })));
  },
};

if (!commands[command]) fail(`usage: evaluation <${Object.keys(commands).join('|')}> ...`);
await commands[command](args);

#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { allowance, estimateTokens, guard, perTrialTokens, selectCases, tokensPerPercent } from './budget.mjs';
import { comparable, compareRuns } from './compare.mjs';
import { appendRun, readRun, listRuns } from './history.mjs';
import { agreement, runJudge, trusted } from './judge.mjs';
import { loadExperiments, loadJudges, loadSuites, readJsonl } from './repo.mjs';
import { replay } from './runners/replay.mjs';
import { runTrial } from './runners/sandbox.mjs';
import { validateCase, validateExperiment, validateSizes, validateSuite } from './schema.mjs';
import { CHANGE_N, HALF_LIFE, MIN_WEIGHTED, ruleChange, ruleRows, ruleTrend } from './rules.mjs';
import { BUILDERS, loadCharts, renderPage, validateChart } from './charts.mjs';
import { caseMeans, noiseFloor } from './stats.mjs';
import { agreement as pairAgreement, buildData, loadRounds, loadTaxonomy, openTask, pairPrompt, parsePick, pending, validateRound } from './visual.mjs';

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
    size: { type: 'string', default: 'small' },
    budget: { type: 'string', default: join(root, 'budget', 'calibration.json') },
    'five-hour-used': { type: 'string' },
    'weekly-used': { type: 'string' },
    'five-hour-before': { type: 'string' },
    'five-hour-after': { type: 'string' },
    'weekly-before': { type: 'string' },
    'weekly-after': { type: 'string' },
    'half-life': { type: 'string', default: String(HALF_LIFE) },
    min: { type: 'string', default: String(MIN_WEIGHTED) },
    since: { type: 'string' },
    n: { type: 'string', default: String(CHANGE_N) },
    at: { type: 'string' },
    list: { type: 'boolean', default: false },
    out: { type: 'string' },
    suite: { type: 'string' },
    baseline: { type: 'string' },
    candidate: { type: 'string' },
    pairs: { type: 'string' },
    title: { type: 'string' },
    param: { type: 'string', multiple: true },
  },
});
const [command, ...args] = positionals;
const print = (value) => console.log(JSON.stringify(value, null, 2));
const fail = (message) => { console.error(message); process.exit(2); };
const suiteNamed = (name) => loadSuites(root).find((s) => s.suite.name === name) ?? fail(`unknown suite ${name}`);
const sizes = () => JSON.parse(readFileSync(join(root, 'sizes.json'), 'utf8'));
const rates = () => (existsSync(flags.budget) ? JSON.parse(readFileSync(flags.budget, 'utf8')) : {});
const pct = (name) => (flags[name] === undefined ? undefined : Number(flags[name]));
const stamp = () => new Date().toISOString();
const newRunId = (label) => `${stamp().replace(/[:.]/g, '-')}-${label}`;

const askClaude = async ({ prompt, model }) => {
  const out = spawnSync('claude', ['-p', '--model', model], { input: prompt, encoding: 'utf8' });
  if (out.error) throw out.error;
  if (out.status !== 0) throw new Error(`claude -p exited ${out.status}: ${out.stdout.trim().slice(0, 200)}`);
  return out.stdout;
};

const review = () => JSON.parse(readFileSync(join(root, 'visual', 'site', 'review.json'), 'utf8'));
const roundNamed = (id) => loadRounds(root).find((r) => r.id === id) ?? fail(`unknown round ${id}`);
const liveVotes = async (round) => {
  const res = await fetch(`${review().site}/api/votes?round=${round.id}`, { headers: { 'x-review-key': process.env.REVIEW_KEY ?? fail('REVIEW_KEY is not set') } });
  if (!res.ok) fail(`votes ${res.status}`);
  return (await res.json()).votes;
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
      ...validateSizes(sizes()),
      ...loadCharts(root).flatMap(validateChart),
      ...loadRounds(root).flatMap((r) => validateRound(r, loadTaxonomy(root))),
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
    const size = sizes().sizes[flags.size] ?? fail(`unknown size ${flags.size}`);
    const picked = selectCases(cases.filter((c) => c.spec.mode === 'sandbox' && (!flags.case || c.spec.id === flags.case)), size);
    const past = listRuns(flags.history, suite.name).map((h) => readRun(flags.history, suite.name, h.runId));
    const used = { fiveHourPct: pct('five-hour-used'), weeklyPct: pct('weekly-used') };
    const plans = arms.map((armName) => {
      const arm = experiment[armName];
      const clash = suite.metrics.find((m) => m.kind === 'judge' && judges[m.judge].model === arm.model);
      if (clash) fail(`judge ${clash.judge} runs on ${arm.model}, the model under test; pin the judge to a different model`);
      const rate = rates()[arm.model] ?? null;
      const estimate = estimateTokens({ cases: picked, arms: 1, perTrial: perTrialTokens(past) });
      const check = guard({ size: flags.size, estimate, rate, used, caps: size.caps });
      if (!check.ok) fail(`budget guard refused ${armName} (${arm.model}):\n${check.reasons.join('\n')}`);
      return { armName, arm, estimate, check, limit: allowance({ rate, caps: size.caps }) };
    });
    for (const { armName, arm, estimate, check, limit } of plans) {
      const runId = newRunId(`${experiment.name}-${armName}`);
      const startedAt = stamp();
      const results = [];
      let spent = 0;
      let partial = false;
      trials: for (const { dir, spec } of picked) {
        for (let trial = 1; trial <= spec.trials; trial++) {
          if (limit !== null && spent > limit) { partial = true; break trials; }
          const out = await runTrial({ caseDir: dir, spec, trial, arm: { ...arm, config: arm.config && join(root, arm.config) } });
          const folder = join(root, 'results', runId, spec.id, `trial-${trial}`);
          mkdirSync(folder, { recursive: true });
          writeFileSync(join(folder, 'transcript.txt'), out.transcript ?? '');
          results.push(...out.rows);
          spent += out.rows.find((r) => r.metric === 'tokens')?.value ?? 0;
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
      const header = { runId, suite: suite.name, mode: 'sandbox', arm: armName, experiment: experiment.name, startedAt, finishedAt: stamp(), variant: arm, size: flags.size, partial, tokens: spent, estimate, uncalibrated: check.uncalibrated };
      print({ file: appendRun(flags.history, { header, results }) });
    }
  },

  compare([suiteName, baselineId, candidateId]) {
    const { suite } = suiteNamed(suiteName);
    const [baseline, candidate] = [baselineId, candidateId].map((id) => readRun(flags.history, suite.name, id));
    for (const run of [baseline, candidate]) { const why = comparable(run); if (why) fail(why); }
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

  'calibrate-budget'([suiteName, runId]) {
    const run = readRun(flags.history, suiteName, runId);
    if (run.header.partial) fail(`run ${runId} is partial`);
    const model = run.header.variant?.model ?? fail(`run ${runId} names no model`);
    const tokens = run.results.filter((r) => r.metric === 'tokens' && r.status === 'ok').reduce((a, r) => a + r.value, 0);
    const all = rates();
    const next = { ...all[model] };
    for (const [key, flag] of [['fiveHour', 'five-hour'], ['weekly', 'weekly']]) {
      const measured = tokensPerPercent({ tokens, before: pct(`${flag}-before`), after: pct(`${flag}-after`) });
      if (measured) next[key] = Math.round(measured);
    }
    writeFileSync(flags.budget, JSON.stringify({ ...all, [model]: { ...next, from: runId, at: stamp() } }, null, 2) + '\n');
    print({ model, tokens, ...next });
  },

  'visual-build'() {
    const file = join(root, 'visual', 'site', 'public', 'data.json');
    const rounds = loadRounds(root);
    writeFileSync(file, JSON.stringify(buildData(rounds, loadTaxonomy(root))));
    print({ file, rounds: rounds.map((r) => ({ id: r.id, pairs: r.pairs.length })) });
  },

  async 'visual-pull'([id]) {
    const round = roundNamed(id);
    const votes = (await liveVotes(round)).sort((a, b) => a.pair.localeCompare(b.pair));
    const file = join(root, 'visual', 'rounds', round.id, 'votes.jsonl');
    writeFileSync(file, votes.map((v) => JSON.stringify(v)).join('\n') + (votes.length ? '\n' : ''));
    print({ file, votes: votes.length, pending: pending(round, votes) });
  },

  async 'visual-notify'([id]) {
    const round = roundNamed(id);
    const open = pending(round, await liveVotes(round));
    const { netTask } = review();
    const task = open ? await openTask({ ...netTask, token: process.env.WEAVE_NET_TOKEN ?? fail('WEAVE_NET_TOKEN is not set') }) : 'nothing to review';
    print({ round: round.id, pending: open, task });
  },

  async 'visual-judge'([id, name = 'glyph-taste']) {
    const round = roundNamed(id);
    const judge = loadJudges(root)[name] ?? fail(`unknown judge ${name}`);
    const rubric = readFileSync(join(root, 'judges', judge.rubric), 'utf8');
    const rows = [];
    for (const pair of round.pairs) {
      const prompt = pairPrompt({ rubric, context: round.context, pair });
      const picks = (await Promise.all(Array.from({ length: judge.votes }, () => askClaude({ prompt, model: judge.model })))).map(parsePick);
      const pick = ['a', 'b', 'both', 'neither'].find((p) => picks.filter((x) => x === p).length * 2 > picks.length) ?? 'unknown';
      rows.push({ pair: pair.id, pick, picks, judge: name, model: judge.model, at: stamp() });
    }
    const file = join(root, 'visual', 'rounds', round.id, 'judge.jsonl');
    writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    print({ file, picks: Object.fromEntries(rows.map((r) => [r.pair, r.pick])) });
  },

  'visual-agree'([id]) {
    const round = roundNamed(id);
    const rows = (name) => { const file = join(root, 'visual', 'rounds', round.id, name); return existsSync(file) ? readJsonl(file) : []; };
    const out = pairAgreement(round, rows('votes.jsonl'), rows('judge.jsonl'));
    print({ round: round.id, pairs: round.pairs.length, ...out });
    process.exit(out.complete ? 0 : 1);
  },

  trend([suiteName]) {
    const { suite } = suiteNamed(suiteName);
    const runs = listRuns(flags.history, suite.name).map((h) => readRun(flags.history, suite.name, h.runId));
    const halfLife = Number(flags['half-life']);
    const metrics = suite.metrics.filter((m) => m.scorer === 'rule').map((m) => m.name);
    print({ suite: suite.name, halfLife, min: Number(flags.min), runs: runs.length, trend: ruleTrend(ruleRows(runs), { metrics, halfLife, min: Number(flags.min), since: flags.since }) });
  },

  charts(ids) {
    const all = loadCharts(root);
    if (flags.list) return print(all.map(({ id, title, form, question, default: shown }) => ({ id, title, form, question, default: shown !== false })));
    const picked = ids.length ? ids.map((id) => all.find((c) => c.id === id) ?? fail(`unknown chart ${id}`)) : all.filter((c) => c.default !== false);
    const results = (suite) => listRuns(flags.history, suite).map((h) => readRun(flags.history, suite, h.runId));
    const ruleRuns = results('harness-rules');
    const tokens = new Map(ruleRuns.flatMap((r) => r.results).filter((r) => r.metric === 'tokens' && r.status === 'ok').map((r) => [r.case, r]));
    const arm = (runId) => (flags.suite && runId ? readRun(flags.history, flags.suite, runId).results : null);
    const ctx = {
      headers: ruleRuns.map((r) => r.header),
      rows: [...ruleRows(ruleRuns), ...tokens.values()],
      turnRows: ruleRows(results('harness-turns')),
      connectorRuns: results('harness-connectors'),
      runs: { baseline: arm(flags.baseline), candidate: arm(flags.candidate) },
      pairs: flags.pairs ? readJsonl(flags.pairs) : [],
    };
    const given = Object.fromEntries((flags.param ?? []).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
    const opts = { halfLife: Number(flags['half-life']), min: Number(flags.min) };
    const page = renderPage(picked.map((spec) => ({ spec, data: BUILDERS[spec.builder](ctx, { ...opts, ...spec.params, ...given }) })), { title: flags.title ?? 'Eval charts' });
    if (!flags.out) fail('pass --out <file.html>');
    writeFileSync(flags.out, page);
    print({ file: flags.out, charts: picked.map((c) => c.id) });
  },

  change([suiteName, sha]) {
    const { suite } = suiteNamed(suiteName);
    if (!sha) fail('usage: evaluation change <suite> <harness commit sha> [--n 30] [--min 20] [--at <commit time>]');
    const runs = listRuns(flags.history, suite.name).map((h) => readRun(flags.history, suite.name, h.runId));
    const metrics = suite.metrics.filter((m) => m.scorer === 'rule').map((m) => m.name);
    try {
      print({ suite: suite.name, ...ruleChange(ruleRows(runs), sha, { metrics, n: Number(flags.n), min: Number(flags.min), at: flags.at }) });
    } catch (e) {
      fail(e.message);
    }
  },

  runs([suiteName]) {
    print(listRuns(flags.history, suiteName).map(({ runId, arm, mode, startedAt, fingerprint }) => ({ runId, arm, mode, startedAt, fingerprint })));
  },
};

if (!commands[command]) fail(`usage: evaluation <${Object.keys(commands).join('|')}> ...`);
await commands[command](args);

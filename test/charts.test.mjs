import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendRun } from '../src/history.mjs';
import { BUILDERS, FORMS, MIN_CELL, agreementMatrix, caseArmGrid, ewSeries, headlineTiles, loadCharts, renderChart, renderPage, ruleScorecard, tokenWeightedOutcome, turnContextGrid, typeSplit, validateChart, weeklyTokens, weightedLines } from '../src/charts.mjs';

const root = join(import.meta.dirname, '..');
const cli = join(root, 'src', 'cli.mjs');
const day = (d) => `2026-11-${String(d).padStart(2, '0')}T10:00:00Z`;
const rule = (id, d, metric, exceptions, checked = 1, over = {}) => ({ type: 'result', case: id, metric, trial: 1, value: checked ? exceptions / checked : null, status: checked ? 'ok' : 'unknown', checked, exempt: 0, waivers: 0, exceptions, at: day(d), track: 'interactive', harness: 'aaa', harnessAt: day(1), ...over });
const tok = (id, value) => ({ type: 'result', case: id, metric: 'tokens', trial: 1, value, status: value == null ? 'unknown' : 'ok' });

test('the library holds the nine chosen templates, each valid and on a known form and builder', () => {
  const charts = loadCharts(root);
  assert.deepEqual(charts.map((c) => c.id).sort(), ['case-by-arm-grid', 'exception-dot-grid', 'exception-rate-by-type', 'headline-tiles', 'judge-agreement-matrix', 'rule-scorecard', 'token-weighted-outcome', 'turn-by-context-grid', 'weekly-tokens-by-outcome']);
  for (const c of charts) assert.deepEqual(validateChart(c), [], c.id);
  assert.deepEqual(Object.keys(FORMS).sort(), ['agreement-matrix', 'case-grid', 'dot-grid', 'heat-grid', 'line', 'scorecard', 'stacked-bar', 'tiles']);
  for (const c of charts) assert.ok(BUILDERS[c.builder], c.builder);
});

test('a spec with no question, an unknown form or an unknown builder is refused', () => {
  const errs = validateChart({ id: 'x', title: 'X', form: 'pie', builder: 'nope' });
  assert.equal(errs.length, 3);
  assert.match(errs.join('\n'), /question is required/);
  assert.match(errs.join('\n'), /form must be one of/);
  assert.match(errs.join('\n'), /builder must be one of/);
});

test('the weighted series halves a row per half-life of age and waits for the minimum weight', () => {
  const pts = ewSeries([{ n: 1, d: 1 }, { n: 0, d: 1 }, { n: 0, d: 0 }, { n: 1, d: 1 }], { num: (r) => r.n, den: (r) => r.d, halfLife: 1, min: 1.5 });
  assert.deepEqual(pts.map((p) => [p.index, p.value]), [[2, 0.333], [3, 0.714]]);
});

test('token weighting pulls the reached share toward the large session', () => {
  const rows = [rule('a', 1, 'outcome', 0), rule('b', 2, 'outcome', 1), rule('c', 3, 'outcome', 0), tok('a', 100), tok('b', 800), tok('c', 100)];
  const data = tokenWeightedOutcome(rows, { halfLife: 1000, min: 1 });
  const last = (name) => data.series.find((s) => s.name === name).points.at(-1).value;
  assert.equal(last('Per session'), 0.667);
  assert.equal(last('Weighted by tokens'), 0.2);
  assert.equal(data.sessions, 3);
});

test('a chart whose rows lack tokens says so and draws no zero', () => {
  const data = tokenWeightedOutcome([rule('a', 1, 'outcome', 0)], {});
  assert.match(data.missing, /tokens/);
  assert.match(weeklyTokens([rule('a', 1, 'outcome', 0)], {}).missing, /tokens/);
  assert.match(renderChart({ id: 'x', title: 'T', question: 'Q', form: 'line', builder: 'token-weighted-outcome' }, data), /No data: /);
});

test('exception lines run per metric on one track', () => {
  const rows = [rule('a', 1, 'response', 1, 2), rule('b', 2, 'response', 0, 2), rule('a', 1, 'outcome', 1), rule('z', 2, 'response', 2, 2, { track: 'automated' })];
  const data = weightedLines(rows, { metrics: ['response', 'outcome'], track: 'interactive', halfLife: 1000, min: 1 });
  assert.deepEqual(data.series.map((s) => [s.name, s.points.at(-1).value]), [['response', 0.25], ['outcome', 1]]);
});

test('weekly tokens split by outcome, weeks starting Monday', () => {
  const rows = [rule('a', 2, 'outcome', 0), rule('b', 9, 'outcome', 1), rule('c', 10, 'outcome', 0), tok('a', 10), tok('b', 30), tok('c', 5)];
  assert.deepEqual(weeklyTokens(rows, {}).bars, [{ label: '11-02', parts: [10, 0] }, { label: '11-09', parts: [5, 30] }]);
});

test('the dot grid shows one row per metric with exception and waiver shares', () => {
  const rows = [rule('a', 1, 'response', 1, 4, { waivers: 1 }), rule('b', 2, 'response', 1, 4), rule('a', 1, 'log', 0, 1)];
  assert.deepEqual(typeSplit(rows, { metrics: ['response', 'log'] }).rows, [
    { label: 'response', checked: 8, exceptions: 2, waivers: 1, exempt: 0, share: 0.25 },
    { label: 'log', checked: 1, exceptions: 0, waivers: 0, exempt: 0, share: 0 },
  ]);
});

test('the turn by context grid buckets turns and hides a rate under the minimum cell size', () => {
  assert.equal(MIN_CELL, 10);
  const turn = (i, t, context, exceptions) => rule(`s#${i}`, 1, 'response', exceptions, 1, { dims: { turn: t, context } });
  const rows = [...Array.from({ length: 10 }, (_, i) => turn(i, 1, 120e3, i < 4 ? 1 : 0)), turn(99, 30, 300e3, 1)];
  const grid = turnContextGrid(rows, {});
  assert.deepEqual(grid.rowLabels, ['Turn 1', '2-5', '6-20', '21+']);
  assert.deepEqual(grid.colLabels, ['<150k', '150-250k', '250k+']);
  assert.deepEqual(grid.cells[0][0], { n: 10, rate: 0.4 });
  assert.deepEqual(grid.cells[3][2], { n: 1, rate: null });
  assert.match(turnContextGrid([rule('a', 1, 'response', 1)], {}).missing, /turn/);
});

test('scorecard and tiles read the same weighted rate, tiles as the kept share in the given order', () => {
  const rows = [rule('a', 1, 'outcome', 1), rule('b', 2, 'outcome', 0), rule('a', 1, 'response', 0, 2), rule('a', 1, 'log', 0, 0)];
  const card = ruleScorecard(rows, { metrics: ['response', 'outcome', 'log'], track: 'interactive', halfLife: 1000, min: 1 });
  assert.deepEqual(card.rows.map((r) => [r.label, r.rate]), [['response', 0], ['outcome', 0.5], ['log', null]]);
  assert.equal(card.rows[1].spark.length, 2);
  const tiles = headlineTiles(rows, { metrics: ['outcome', 'response', 'log'], track: 'interactive', halfLife: 1000, min: 1 });
  assert.deepEqual(tiles.tiles, [{ label: 'outcome', value: 0.5 }, { label: 'response', value: 1 }, { label: 'log', value: null }]);
});

test('the case by arm grid counts trials passed per case and arm', () => {
  const r = (c, trial, value) => ({ case: c, metric: 'reads_human', trial, value, status: value == null ? 'unknown' : 'ok' });
  const grid = caseArmGrid({ baseline: [r('a', 1, 1), r('a', 2, 0), r('b', 1, 0)], candidate: [r('a', 1, 1), r('a', 2, 1), r('b', 1, null)] }, { metric: 'reads_human' });
  assert.deepEqual(grid.rows, [{ label: 'a', cells: [{ passed: 1, trials: 2 }, { passed: 2, trials: 2 }] }, { label: 'b', cells: [{ passed: 0, trials: 1 }, { passed: 0, trials: 0 }] }]);
});

test('the agreement matrix counts human label against judge verdict, by field path', () => {
  const pairs = [{ label: 'PASS', judge: { v: 1 } }, { label: 'FAIL', judge: { v: 1 } }, { label: 'FAIL', judge: { v: 0 } }, { label: 'pass', judge: { v: 'fail' } }];
  const m = agreementMatrix(pairs, { verdict: 'judge.v' });
  assert.deepEqual([m.passPass, m.passFail, m.failPass, m.failFail, m.agree, m.n], [1, 1, 1, 1, 2, 4]);
  assert.match(agreementMatrix([], {}).missing, /label/);
});

test('every form renders its data without NaN and escapes titles', () => {
  const spec = (form) => ({ id: form, title: 'A <b> title', question: 'Q?', form, builder: 'x' });
  const html = [
    renderChart(spec('line'), { series: [{ name: 'response', points: [{ index: 1, at: day(1), value: 0.2 }, { index: 2, at: day(2), value: 0.4 }] }], unit: 'exception rate' }),
    renderChart(spec('stacked-bar'), { bars: [{ label: '11-02', parts: [10, 0] }], parts: ['Reached', 'Unreached'] }),
    renderChart(spec('dot-grid'), { rows: [{ label: 'response', checked: 8, exceptions: 2, waivers: 1, exempt: 0, share: 0.25 }] }),
    renderChart(spec('heat-grid'), { rowLabels: ['Turn 1'], colLabels: ['<150k'], cells: [[{ n: 10, rate: 0.4 }]] }),
    renderChart(spec('scorecard'), { rows: [{ label: 'log', rate: null, spark: [] }, { label: 'response', rate: 0.2, spark: [0.1, 0.2] }] }),
    renderChart(spec('tiles'), { tiles: [{ label: 'outcome', value: 0.5 }, { label: 'log', value: null }] }),
    renderChart(spec('case-grid'), { arms: ['baseline', 'candidate'], rows: [{ label: 'a', cells: [{ passed: 1, trials: 2 }, { passed: 2, trials: 2 }] }] }),
    renderChart(spec('agreement-matrix'), { passPass: 1, passFail: 3, failPass: 7, failFail: 1, agree: 2, n: 12 }),
  ].join('\n');
  assert.doesNotMatch(html, /NaN|undefined/);
  assert.doesNotMatch(html, /A <b> title/);
  assert.match(html, /A &lt;b&gt; title/);
  assert.match(html, /unknown/);
  assert.match(html, /2 of 12/);
  const page = renderPage([{ spec: spec('tiles'), data: { tiles: [] } }], { title: 'Run r1' });
  assert.match(page, /^<!doctype html>/);
  assert.match(page, /prefers-color-scheme: dark/);
});

test('the charts command lists templates and writes one page from history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'charts-'));
  const results = [];
  for (let i = 0; i < 30; i++) results.push(rule(`s${i}`, 1 + (i % 20), 'response', i % 3 === 0 ? 1 : 0, 2), rule(`s${i}`, 1 + (i % 20), 'outcome', i % 5 === 0 ? 1 : 0), tok(`s${i}`, 1000 * (i + 1)));
  appendRun(dir, { header: { runId: 'r1', suite: 'harness-rules', mode: 'replay', arm: 'nightly', startedAt: day(21), variant: {} }, results });
  const list = spawnSync('node', [cli, 'charts', '--list'], { encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  assert.equal(JSON.parse(list.stdout).length, 9);
  const out = join(dir, 'page.html');
  const made = spawnSync('node', [cli, 'charts', 'token-weighted-outcome', 'exception-rate-by-type', 'turn-by-context-grid', '--history', dir, '--out', out, '--min', '1'], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  const page = readFileSync(out, 'utf8');
  assert.match(page, /Token-weighted outcome/);
  assert.match(page, /<polyline/);
  assert.match(page, /No data: /);
  assert.doesNotMatch(page, /NaN/);
  writeFileSync(join(dir, 'pairs.jsonl'), [{ label: 'PASS', judge: { v: 1 } }, { label: 'FAIL', judge: { v: 1 } }].map((l) => JSON.stringify(l)).join('\n'));
  const judged = spawnSync('node', [cli, 'charts', 'judge-agreement-matrix', '--history', dir, '--out', out, '--pairs', join(dir, 'pairs.jsonl'), '--param', 'verdict=judge.v'], { encoding: 'utf8' });
  assert.equal(judged.status, 0, judged.stderr);
  assert.match(readFileSync(out, 'utf8'), /Agreement 1 of 2/);
});

test('replay carries tokens as a metric and turn dimensions on a rule row', async () => {
  const { replay } = await import('../src/runners/replay.mjs');
  const { loadSuites } = await import('../src/repo.mjs');
  const { validateSuite } = await import('../src/schema.mjs');
  const suites = Object.fromEntries(loadSuites(root).map((s) => [s.suite.name, s.suite]));
  assert.deepEqual(validateSuite(suites['harness-turns']), []);
  const counts = { checked: 1, exempt: 0, waivers: 0, exceptions: 1 };
  const session = replay({ suite: suites['harness-rules'], sessions: [{ id: 's1', at: day(1), track: 'interactive', tokens: 4200, outcome: counts }] });
  assert.deepEqual(session.find((r) => r.metric === 'tokens'), { case: 's1', metric: 'tokens', trial: 1, split: 'heldout', value: 4200, status: 'ok' });
  assert.equal(replay({ suite: suites['harness-rules'], sessions: [{ id: 's2' }] }).find((r) => r.metric === 'tokens').status, 'unknown');
  const turn = replay({ suite: suites['harness-turns'], sessions: [{ id: 's1#3', at: day(1), track: 'interactive', response: counts, dims: { turn: 3, context: 180000 } }] });
  assert.deepEqual(turn[0].dims, { turn: 3, context: 180000 });
  assert.equal(session.find((r) => r.metric === 'outcome').dims, undefined);
});

test('a long bar chart labels at most twelve bars so dates never collide', () => {
  const bars = Array.from({ length: 30 }, (_, i) => ({ label: `w${i}`, parts: [i + 1, 1] }));
  const html = renderChart({ id: 'x', title: 'T', question: 'Q', form: 'stacked-bar', builder: 'x' }, { bars, parts: ['Reached', 'Unreached'] });
  const labels = html.match(/>w\d+</g);
  assert.ok(labels.length <= 12, String(labels.length));
  assert.ok(labels.includes('>w0<') && labels.includes('>w29<'));
  assert.equal(html.match(/<rect /g).length, 60);
});

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { HALF_LIFE, MIN_WEIGHTED } from './rules.mjs';

export const MIN_CELL = 10;
export const TURN_BANDS = [['Turn 1', 1], ['2-5', 5], ['6-20', 20], ['21+', Infinity]];
export const CONTEXT_BANDS = [['<150k', 150e3], ['150-250k', 250e3], ['250k+', Infinity]];

const round3 = (n) => Math.round(n * 1000) / 1000;
const sum = (rows, f) => rows.reduce((n, r) => n + f(r), 0);
const scored = (rows, metric, track) => rows.filter((r) => r.metric === metric && r.checked > 0 && (!track || r.track === track)).sort((a, b) => String(a.at).localeCompare(String(b.at)));
const tokenMap = (rows) => new Map(rows.filter((r) => r.metric === 'tokens' && r.value > 0).map((r) => [r.case, r.value]));
const NO_TOKENS = 'no session carries tokens; export the tokens metric with the rule rows';

export function ewSeries(rows, { num, den, gate = den, halfLife = HALF_LIFE, min = MIN_WEIGHTED }) {
  const decay = 0.5 ** (1 / halfLife);
  let n = 0;
  let d = 0;
  let g = 0;
  let index = 0;
  const points = [];
  for (const r of rows) {
    const weight = den(r);
    if (!weight) continue;
    n = n * decay + num(r);
    d = d * decay + weight;
    g = g * decay + gate(r);
    index += 1;
    if (g >= min) points.push({ index, at: r.at ?? null, value: round3(n / d) });
  }
  return points;
}

export function weightedLines(rows, { metrics, track, halfLife, min }) {
  return { unit: 'exception rate', series: metrics.map((name) => ({ name, points: ewSeries(scored(rows, name, track), { num: (r) => r.exceptions, den: (r) => r.checked, halfLife, min }) })) };
}

export function tokenWeightedOutcome(rows, { track, halfLife, min }) {
  const tokens = tokenMap(rows);
  const mine = scored(rows, 'outcome', track).filter((r) => !r.waivers && tokens.has(r.case));
  if (!mine.length) return { missing: NO_TOKENS };
  const reached = (r) => (r.exceptions ? 0 : 1);
  const tk = (r) => tokens.get(r.case);
  return {
    unit: 'reached share',
    sessions: mine.length,
    series: [
      { name: 'Weighted by tokens', points: ewSeries(mine, { num: (r) => tk(r) * reached(r), den: tk, gate: () => 1, halfLife, min }) },
      { name: 'Per session', points: ewSeries(mine, { num: reached, den: () => 1, halfLife, min }) },
    ],
  };
}

const monday = (at) => {
  const d = new Date(at);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(5, 10);
};

export function weeklyTokens(rows, { track }) {
  const tokens = tokenMap(rows);
  const mine = scored(rows, 'outcome', track).filter((r) => tokens.has(r.case));
  if (!mine.length) return { missing: NO_TOKENS };
  const weeks = new Map();
  for (const r of mine) {
    const parts = weeks.get(monday(r.at)) ?? [0, 0];
    parts[r.exceptions ? 1 : 0] += tokens.get(r.case);
    weeks.set(monday(r.at), parts);
  }
  return { parts: ['Reached', 'Unreached'], unit: 'tokens', bars: [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([label, parts]) => ({ label, parts })) };
}

export function typeSplit(rows, { metrics, track }) {
  return {
    rows: metrics.map((label) => {
      const mine = rows.filter((r) => r.metric === label && r.checked !== undefined && (!track || r.track === track));
      const checked = sum(mine, (r) => r.checked);
      const exceptions = sum(mine, (r) => r.exceptions);
      return { label, checked, exceptions, waivers: sum(mine, (r) => r.waivers), exempt: sum(mine, (r) => r.exempt), share: checked ? round3(exceptions / checked) : null };
    }),
  };
}

const band = (bands, v) => bands.findIndex(([, top]) => v <= top);

export function turnContextGrid(rows, { metric = 'response' }) {
  const turns = rows.filter((r) => r.metric === metric && r.checked > 0 && r.dims?.turn);
  if (!turns.length) return { missing: 'no turn rows; export the harness-turns suite' };
  const cells = TURN_BANDS.map(() => CONTEXT_BANDS.map(() => ({ n: 0, hits: 0 })));
  for (const r of turns) {
    const cell = cells[band(TURN_BANDS, r.dims.turn)][CONTEXT_BANDS.findIndex(([, top]) => (r.dims.context ?? 0) < top)];
    cell.n += r.checked;
    cell.hits += r.exceptions;
  }
  return { rowLabels: TURN_BANDS.map(([l]) => l), colLabels: CONTEXT_BANDS.map(([l]) => l), cells: cells.map((row) => row.map(({ n, hits }) => ({ n, rate: n >= MIN_CELL ? round3(hits / n) : null }))) };
}

export function ruleScorecard(rows, { metrics, track, halfLife, min }) {
  return {
    rows: weightedLines(rows, { metrics, track, halfLife, min }).series.map(({ name, points }) => ({ label: name, rate: points.at(-1)?.value ?? null, spark: points.map((p) => p.value) })),
  };
}

export function headlineTiles(rows, opts) {
  return { tiles: ruleScorecard(rows, opts).rows.map(({ label, rate }) => ({ label, value: rate === null ? null : round3(1 - rate) })) };
}

export function caseArmGrid(runs, { metric }) {
  const arms = Object.keys(runs);
  if (!arms.length || arms.some((a) => !runs[a])) return { missing: 'pass --suite, --baseline and --candidate' };
  const cases = [...new Set(arms.flatMap((a) => runs[a].filter((r) => r.metric === metric).map((r) => r.case)))];
  const cell = (arm, id) => {
    const mine = runs[arm].filter((r) => r.metric === metric && r.case === id && r.status === 'ok');
    return { passed: sum(mine, (r) => r.value), trials: mine.length };
  };
  return { arms, metric, rows: cases.map((label) => ({ label, cells: arms.map((a) => cell(a, label)) })) };
}

const at = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const verdictOf = (v) => (v === 1 || v === true || /^pass$/i.test(String(v)) ? 'pass' : v === 0 || v === false || /^fail$/i.test(String(v)) ? 'fail' : null);

export function agreementMatrix(pairs, { label = 'label', verdict = 'verdict' }) {
  const known = pairs.map((p) => [verdictOf(at(p, label)), verdictOf(at(p, verdict))]).filter(([l, v]) => l && v);
  if (!known.length) return { missing: 'no pairs with a human label and a judge verdict; pass --pairs' };
  const count = (l, v) => known.filter(([a, b]) => a === l && b === v).length;
  const m = { passPass: count('pass', 'pass'), passFail: count('pass', 'fail'), failPass: count('fail', 'pass'), failFail: count('fail', 'fail') };
  return { ...m, agree: m.passPass + m.failFail, n: known.length };
}

export const BUILDERS = {
  'token-weighted-outcome': (ctx, p) => tokenWeightedOutcome(ctx.rows, p),
  'weighted-lines': (ctx, p) => weightedLines(ctx.rows, p),
  'weekly-tokens': (ctx, p) => weeklyTokens(ctx.rows, p),
  'type-split': (ctx, p) => typeSplit(ctx.rows, p),
  'turn-context-grid': (ctx, p) => turnContextGrid(ctx.turnRows, p),
  'rule-scorecard': (ctx, p) => ruleScorecard(ctx.rows, p),
  'headline-tiles': (ctx, p) => headlineTiles(ctx.rows, p),
  'case-arm-grid': (ctx, p) => caseArmGrid(ctx.runs, p),
  'agreement-matrix': (ctx, p) => agreementMatrix(ctx.pairs, p),
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (v) => (v === null || v === undefined ? 'unknown' : `${Math.round(v * 1000) / 10}%`);
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
const DASH = ['', '6 4', '2 3', '8 3 2 3'];
const legend = (names) => `<p class="legend">${names.map((n, i) => `<span><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="${SERIES[i % 4]}" stroke-width="2" stroke-dasharray="${DASH[i % 4]}"/></svg>${esc(n)}</span>`).join('')}</p>`;
const polyline = (values, { w, h, top = 1 }) => values.map((v, i) => `${(values.length > 1 ? (i * w) / (values.length - 1) : w / 2).toFixed(1)},${(h - (v / top) * h).toFixed(1)}`).join(' ');

function line({ series, unit }) {
  const drawn = series.filter((s) => s.points.length);
  if (!drawn.length) return '<p class="empty">No data: too few scored sessions for a weighted rate</p>';
  const top = Math.min(1, Math.max(0.1, Math.ceil(Math.max(...drawn.flatMap((s) => s.points.map((p) => p.value))) * 10) / 10));
  const W = 600;
  const H = 180;
  const grid = [0, 0.5, 1].map((f) => `<line x1="40" x2="${40 + W}" y1="${10 + H - f * H}" y2="${10 + H - f * H}" class="rule"/><text x="34" y="${14 + H - f * H}" text-anchor="end">${pct(f * top)}</text>`).join('');
  const lines = series.map((s, i) => (s.points.length ? `<g transform="translate(40 10)"><polyline fill="none" stroke="${SERIES[i % 4]}" stroke-width="2" stroke-dasharray="${DASH[i % 4]}" points="${polyline(s.points.map((p) => p.value), { w: W, h: H, top })}"/></g>` : '')).join('');
  const first = drawn[0].points[0].at?.slice(0, 10) ?? '';
  const last = drawn[0].points.at(-1).at?.slice(0, 10) ?? '';
  return `${legend(series.map((s) => `${s.name} ${pct(s.points.at(-1)?.value ?? null)}`))}<svg viewBox="0 0 660 215" role="img" aria-label="${esc(unit)} over sessions">${grid}${lines}<text x="40" y="208">${esc(first)}</text><text x="640" y="208" text-anchor="end">${esc(last)}</text></svg>`;
}

const millions = (n) => `${Math.round(n / 1e5) / 10}M`;

function stackedBar({ bars, parts }) {
  const top = Math.max(...bars.map((b) => b.parts[0] + b.parts[1]), 1);
  const step = 600 / bars.length;
  const width = Math.min(28, step - 4);
  const every = Math.ceil(bars.length / 11);
  const labelled = (i) => i === bars.length - 1 || (i % every === 0 && bars.length - 1 - i >= every / 2);
  const rects = bars.map((b, i) => {
    const x = 40 + i * step + (step - width) / 2;
    const [a, c] = b.parts.map((v) => (v / top) * 170);
    return `<rect x="${x.toFixed(1)}" y="${(190 - a).toFixed(1)}" width="${width.toFixed(1)}" height="${a.toFixed(1)}" fill="var(--s3)"/><rect x="${x.toFixed(1)}" y="${(188 - a - c).toFixed(1)}" width="${width.toFixed(1)}" height="${c.toFixed(1)}" fill="var(--s2)"/>${labelled(i) ? `<text x="${(x + width / 2).toFixed(1)}" y="206" text-anchor="middle">${esc(b.label)}</text>` : ''}`;
  }).join('');
  return `<p class="legend"><span><i style="background:var(--s3)"></i>${esc(parts[0])}</span><span><i style="background:var(--s2)"></i>${esc(parts[1])}</span><span>tallest bar ${millions(top)}</span></p><svg viewBox="0 0 660 215" role="img" aria-label="tokens per week by outcome"><line x1="40" x2="640" y1="190" y2="190" class="rule"/>${rects}</svg>`;
}

function dotGrid({ rows }) {
  return `<p class="legend"><span><i style="background:var(--s3)"></i>Kept</span><span><i style="background:var(--s2)"></i>Exception</span><span>one dot = 2% of checked units</span></p>${rows.map((r) => {
    const hits = r.share === null ? 0 : Math.round(r.share * 50);
    const dots = r.share === null ? '<span class="muted">unknown</span>' : Array.from({ length: 50 }, (_, i) => `<b class="${i < hits ? 'hit' : 'kept'}"></b>`).join('');
    return `<div class="row"><span>${esc(r.label)}</span><div class="dots">${dots}</div><span>${pct(r.share)} of ${r.checked}, ${r.waivers} waived, ${r.exempt} exempt</span></div>`;
  }).join('')}`;
}

function heatGrid({ rowLabels, colLabels, cells }) {
  const head = `<tr><th></th>${colLabels.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
  const body = cells.map((row, i) => `<tr><th>${esc(rowLabels[i])}</th>${row.map((c) => (c.rate === null ? `<td class="muted">n ${c.n}</td>` : `<td style="background:color-mix(in srgb, var(--s2) ${Math.round(c.rate * 70)}%, transparent)">${pct(c.rate)}<small> n ${c.n}</small></td>`)).join('')}</tr>`).join('');
  return `<table class="grid">${head}${body}</table><p class="legend"><span>darker cell = higher exception rate; a cell under ${MIN_CELL} turns shows its count only</span></p>`;
}

function scorecard({ rows }) {
  return `<table class="card">${rows.map((r, i) => `<tr><th>${esc(r.label)}</th><td class="num">${pct(r.rate)}</td><td>${r.spark.length > 1 ? `<svg width="140" height="24" viewBox="0 0 140 24"><polyline fill="none" stroke="${SERIES[i % 4]}" stroke-width="1.5" points="${polyline(r.spark, { w: 140, h: 22, top: Math.max(...r.spark, 0.01) })}"/></svg>` : ''}</td></tr>`).join('')}</table><p class="legend"><span>exception rate now, with its path</span></p>`;
}

function tiles({ tiles: list }) {
  return `<div class="tiles">${list.map((t) => `<div><span>${esc(t.label)} kept</span><strong>${pct(t.value)}</strong></div>`).join('')}</div>`;
}

function caseGrid({ arms, rows, metric }) {
  const cell = (c) => (c.trials ? `<td style="background:color-mix(in srgb, var(--s3) ${Math.round((c.passed / c.trials) * 60) + 8}%, transparent)">${c.passed}/${c.trials}</td>` : '<td class="muted">unknown</td>');
  return `<table class="grid"><tr><th>${esc(metric ?? '')}</th>${arms.map((a) => `<th>${esc(a)}</th>`).join('')}</tr>${rows.map((r) => `<tr><th>${esc(r.label)}</th>${r.cells.map(cell).join('')}</tr>`).join('')}</table><p class="legend"><span>trials passed per case</span></p>`;
}

function agreement(m) {
  return `<table class="grid"><tr><th></th><th>Judge pass</th><th>Judge fail</th></tr><tr><th>Human pass</th><td class="agree">${m.passPass}</td><td class="split">${m.passFail}</td></tr><tr><th>Human fail</th><td class="split">${m.failPass}</td><td class="agree">${m.failFail}</td></tr></table><p class="legend"><span>Agreement ${m.agree} of ${m.n}</span></p>`;
}

export const FORMS = { line, 'stacked-bar': stackedBar, 'dot-grid': dotGrid, 'heat-grid': heatGrid, scorecard, tiles, 'case-grid': caseGrid, 'agreement-matrix': agreement };

export function validateChart(spec) {
  const errs = [];
  const where = `chart ${spec.id ?? '?'}`;
  for (const f of ['id', 'title', 'question']) if (!spec[f]) errs.push(`${where}: ${f} is required`);
  if (!FORMS[spec.form]) errs.push(`${where}: form must be one of ${Object.keys(FORMS).join(', ')}`);
  if (!BUILDERS[spec.builder]) errs.push(`${where}: builder must be one of ${Object.keys(BUILDERS).join(', ')}`);
  return errs;
}

export const loadCharts = (root) =>
  readdirSync(join(root, 'charts')).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(root, 'charts', f), 'utf8')));

export function renderChart(spec, data) {
  const body = data.missing ? `<p class="empty">No data: ${esc(data.missing)}</p>` : FORMS[spec.form](data);
  return `<section id="${esc(spec.id)}"><h2>${esc(spec.title)}</h2><p class="question">${esc(spec.question)}</p>${body}</section>`;
}

const STYLE = `:root{--bg:#fafaf8;--panel:#fff;--ink:#0c1b33;--ink2:#52514e;--line:#e1e0d9;--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#898781}
@media (prefers-color-scheme: dark){:root{--bg:#0c1b33;--panel:#132444;--ink:#e0dcd4;--ink2:#b4b8c4;--line:#2a3a5c;--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#898781}}
body{margin:0;padding:32px 16px;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px}
h1{grid-column:1/-1;font-size:24px;margin:0}
section{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px;min-width:0}
h2{font-size:16px;margin:0}
.question,.legend,.muted,small,text{color:var(--ink2);font-size:12px}
text{fill:var(--ink2)}
.question{margin:2px 0 12px}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:8px 0}
.legend span{display:inline-flex;align-items:center;gap:5px}
.legend i{width:10px;height:10px;border-radius:2px}
svg{max-width:100%}
.rule{stroke:var(--line)}
.empty{color:var(--ink2);padding:32px 0;text-align:center}
.row{display:grid;grid-template-columns:72px 1fr;gap:4px 10px;align-items:center;margin-bottom:8px}
.row span:last-child{grid-column:2;font-size:12px;color:var(--ink2)}
.dots{display:flex;flex-wrap:wrap;gap:2px}
.dots b{width:8px;height:8px;border-radius:50%}
.kept{background:var(--s3)}.hit{background:var(--s2)}
table{border-collapse:separate;border-spacing:3px;width:100%}
th{font-weight:500;text-align:left;font-size:12px;color:var(--ink2)}
.grid td{text-align:center;padding:8px 4px;border-radius:4px}
.agree{background:color-mix(in srgb,var(--s3) 35%,transparent)}.split{background:color-mix(in srgb,var(--s2) 45%,transparent)}
.num{font-variant-numeric:tabular-nums;font-size:18px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px}
.tiles div{background:var(--bg);border-radius:8px;padding:10px 12px}
.tiles span{display:block;font-size:12px;color:var(--ink2)}
.tiles strong{font-size:24px;font-weight:500}`;

export function renderPage(items, { title }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main><h1>${esc(title)}</h1>${items.map(({ spec, data }) => renderChart(spec, data)).join('')}</main></body></html>\n`;
}

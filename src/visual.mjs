import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const PICKS = ['a', 'b', 'both', 'neither'];

export const loadTaxonomy = (root) => json(join(root, 'visual', 'taxonomy.json'));

export const loadRounds = (root) => {
  const dir = join(root, 'visual', 'rounds');
  return readdirSync(dir).filter((id) => existsSync(join(dir, id, 'round.json'))).sort().map((id) => {
    const round = json(join(dir, id, 'round.json'));
    const option = (o) => ({ ...o, svg: readFileSync(join(dir, id, o.file), 'utf8').trim() });
    return { ...round, pairs: round.pairs.map((p) => ({ ...p, a: option(p.a), b: option(p.b) })) };
  });
};

export const safeSvg = (svg) => /^<svg[\s>]/.test(String(svg).trim()) && !/<script|<image|<foreignObject|<use|href\s*=|\son[a-z]+\s*=|url\(|@import|javascript:/i.test(svg);

export const validateRound = (round, taxonomy) => {
  const errs = [];
  const at = (p) => `round ${round.id} pair ${p.id}`;
  if (!taxonomy.media.includes(round.medium)) errs.push(`round ${round.id} has unknown medium ${round.medium}`);
  if (!round.context) errs.push(`round ${round.id} needs a context`);
  const ids = new Set();
  for (const p of round.pairs ?? []) {
    if (ids.has(p.id)) errs.push(`${at(p)} repeats an id`);
    ids.add(p.id);
    for (const field of ['subject', 'objective']) if (!p[field]) errs.push(`${at(p)} needs a ${field}`);
    const keys = [...new Set([...Object.keys(p.a.arm), ...Object.keys(p.b.arm)])];
    for (const k of keys) if (!(k in taxonomy.axes)) errs.push(`${at(p)} uses unknown axis ${k}`);
    const differs = keys.filter((k) => p.a.arm[k] !== p.b.arm[k]);
    if (differs.length !== 1) errs.push(`${at(p)} arms must differ on exactly one axis, found ${differs.length}`);
    else if (differs[0] !== p.axis) errs.push(`${at(p)} names axis ${p.axis} but the arms differ on ${differs[0]}`);
    for (const side of ['a', 'b']) {
      if (!safeSvg(p[side].svg)) errs.push(`${at(p)} option ${side} is unsafe or is no svg`);
      if (!p[side].intent) errs.push(`${at(p)} option ${side} needs an intent`);
    }
  }
  return errs;
};

export const buildData = (rounds, taxonomy) => ({
  verdicts: taxonomy.verdicts,
  axes: taxonomy.axes,
  reasons: taxonomy.reasons,
  rounds: rounds.map(({ id, title, medium, context, pairs }) => ({
    id, title, medium, context,
    pairs: pairs.map(({ id, subject, objective, axis, a, b }) => ({ id, subject, objective, axis, a: { svg: a.svg, arm: a.arm, intent: a.intent }, b: { svg: b.svg, arm: b.arm, intent: b.intent } })),
  })),
});

export const pending = (round, votes) => {
  const voted = new Set(votes.filter((v) => v.round === undefined || v.round === round.id).map((v) => v.pair));
  return round.pairs.filter((p) => !voted.has(p.id)).length;
};

export const parsePick = (text) => {
  const m = String(text).match(/<verdict>\s*(a|b|both|neither)\s*<\/verdict>/i);
  return m ? m[1].toLowerCase() : 'unknown';
};

export const pairPrompt = ({ rubric, context, pair }) => `You compare two options made for the same objective and pick as the reviewer described in the rubric would pick.
<context>
${context}
</context>
<objective>
${pair.objective}
</objective>
<rubric>
${rubric}
</rubric>
<option-a>
${pair.a.svg}
</option-a>
<option-b>
${pair.b.svg}
</option-b>
Reason inside <thinking> tags. Then answer with exactly one of <verdict>A</verdict> (A is the one to ship), <verdict>B</verdict> (B is the one to ship), <verdict>BOTH</verdict> (either could ship) or <verdict>NEITHER</verdict> (neither could ship).`;

export const agreement = (round, votes, picks) => {
  const pick = new Map(picks.map((p) => [p.pair, p.pick]));
  const human = new Map(votes.map((v) => [v.pair, v.verdict]));
  const rows = round.pairs.filter((p) => human.has(p.id) && PICKS.includes(pick.get(p.id)));
  const byAxis = {};
  const misses = [];
  for (const p of rows) {
    const hit = human.get(p.id) === pick.get(p.id);
    byAxis[p.axis] ??= { n: 0, agree: 0 };
    byAxis[p.axis].n += 1;
    if (hit) byAxis[p.axis].agree += 1;
    else misses.push({ pair: p.id, human: human.get(p.id), judge: pick.get(p.id) });
  }
  const agree = rows.length - misses.length;
  return { n: rows.length, agree, rate: rows.length ? agree / rows.length : null, complete: rows.length === round.pairs.length && misses.length === 0, misses, byAxis };
};

export const openTask = async ({ base, token, id, fetch = globalThis.fetch }) => {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const call = async (path, init = {}) => {
    const res = await fetch(`${base}/api${path}`, { ...init, headers });
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} ${res.status}`);
    return res.json();
  };
  const task = await call(`/entities/${id}`);
  if ((task.fields?.State ?? task.state) === 'Open') return 'already open';
  await call(`/entities/${id}/conditional`, { method: 'POST', body: JSON.stringify({ expectedRevision: task.revision, operation: 'state', field: 'State', state: 'Open' }) });
  return 'opened';
};

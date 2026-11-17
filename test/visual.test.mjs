import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { agreement, buildData, loadRounds, loadTaxonomy, openTask, pairPrompt, parsePick, pending, safeSvg, validateRound } from '../src/visual.mjs';
import { onRequestGet, onRequestPut } from '../visual/site/functions/api/votes.js';

const root = join(import.meta.dirname, '..');
const taxonomy = loadTaxonomy(root);
const base = { model: 'm1', effort: 'default', skill: 'none', colorToken: 'currentColor', construction: 'outline', intent: 'literal' };
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1h2"/></svg>';
const pair = (over = {}) => ({
  id: 'table', subject: 'Table', objective: 'Draw a table glyph.', axis: 'model',
  a: { arm: base, svg, intent: 'A grid.' },
  b: { arm: { ...base, model: 'm2' }, svg, intent: 'A grid.' },
  ...over,
});
const round = (pairs = [pair()]) => ({ id: 'r1', title: 'Round', medium: 'glyph', context: 'Sidebar.', pairs });

test('parsePick reads one of four picks from the verdict tag', () => {
  assert.equal(parsePick('<thinking>B is busy</thinking><verdict>A</verdict>'), 'a');
  assert.equal(parsePick('<verdict> both </verdict>'), 'both');
  assert.equal(parsePick('<verdict>NEITHER</verdict>'), 'neither');
  assert.equal(parsePick('A'), 'unknown');
});

test('a well-formed round validates clean', () => {
  assert.deepEqual(validateRound(round(), taxonomy), []);
});

test('a pair states its subject and objective', () => {
  const errs = validateRound(round([pair({ objective: '' })]), taxonomy);
  assert.match(errs.join('\n'), /objective/);
});

test('the two arms of a pair differ on the named axis and nothing else', () => {
  const two = pair({ b: { arm: { ...base, model: 'm2', effort: 'high' }, svg, intent: 'x' } });
  assert.match(validateRound(round([two]), taxonomy).join('\n'), /differ on exactly one axis/);
  const wrong = pair({ axis: 'effort' });
  assert.match(validateRound(round([wrong]), taxonomy).join('\n'), /axis effort/);
  const unknown = pair({ a: { arm: { ...base, mood: 'x' }, svg, intent: 'x' }, b: { arm: { ...base, mood: 'y' }, svg, intent: 'x' }, axis: 'mood' });
  assert.match(validateRound(round([unknown]), taxonomy).join('\n'), /unknown axis mood/);
});

test('an option that carries script or an outside reference is refused', () => {
  assert.equal(safeSvg(svg), true);
  assert.equal(safeSvg('<svg><script>1</script></svg>'), false);
  assert.equal(safeSvg('<svg><image href="https://x.test/a.png"/></svg>'), false);
  assert.equal(safeSvg('<svg onload="x()"></svg>'), false);
  assert.equal(safeSvg('<p>hi</p>'), false);
  const bad = pair({ a: { arm: base, svg: '<svg><script>1</script></svg>', intent: 'x' } });
  assert.match(validateRound(round([bad]), taxonomy).join('\n'), /unsafe/);
});

test('every committed round validates and carries its drawings', () => {
  const rounds = loadRounds(root);
  assert.ok(rounds.length >= 1);
  for (const r of rounds) {
    assert.deepEqual(validateRound(r, taxonomy), []);
    for (const p of r.pairs) assert.match(p.a.svg + p.b.svg, /<svg/);
  }
});

test('buildData carries the taxonomy and every pair for the page', () => {
  const data = buildData([round()], taxonomy);
  assert.equal(data.rounds[0].pairs[0].a.svg, svg);
  assert.ok(data.reasons.length >= 6);
  assert.deepEqual(data.verdicts, ['a', 'b', 'both', 'neither']);
});

test('pending counts the pairs with no vote', () => {
  const r = round([pair(), pair({ id: 'board' })]);
  assert.equal(pending(r, []), 2);
  assert.equal(pending(r, [{ round: 'r1', pair: 'table', verdict: 'a' }]), 1);
});

test('agreement is the share of voted pairs where judge and human pick the same', () => {
  const r = round([pair(), pair({ id: 'board', axis: 'model' }), pair({ id: 'doc' })]);
  const votes = [{ pair: 'table', verdict: 'a' }, { pair: 'board', verdict: 'both' }];
  const picks = [{ pair: 'table', pick: 'a' }, { pair: 'board', pick: 'b' }, { pair: 'doc', pick: 'a' }];
  const out = agreement(r, votes, picks);
  assert.equal(out.n, 2);
  assert.equal(out.agree, 1);
  assert.equal(out.rate, 0.5);
  assert.equal(out.complete, false);
  assert.deepEqual(out.misses, [{ pair: 'board', human: 'both', judge: 'b' }]);
  assert.deepEqual(out.byAxis, { model: { n: 2, agree: 1 } });
});

test('agreement is complete only when every pair is voted and matched', () => {
  const r = round();
  assert.equal(agreement(r, [{ pair: 'table', verdict: 'a' }], [{ pair: 'table', pick: 'a' }]).complete, true);
  assert.equal(agreement(r, [], []).rate, null);
});

test('pairPrompt shows the objective and both drawings and asks for one pick', () => {
  const p = pairPrompt({ rubric: 'Prefer the clearer glyph.', context: 'Sidebar.', pair: pair() });
  assert.match(p, /<objective>\nDraw a table glyph\.\n<\/objective>/);
  assert.match(p, /<option-a>/);
  assert.match(p, /<option-b>/);
  assert.match(p, /<verdict>/);
  assert.doesNotMatch(p, /m1|m2/);
});

const kv = () => {
  const store = new Map();
  return {
    store,
    put: async (k, v) => { store.set(k, v); },
    get: async (k) => store.get(k) ?? null,
    list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
  };
};
const req = (method, { key, body, query = '' } = {}) => new Request(`https://review.test/api/votes${query}`, {
  method,
  headers: { 'content-type': 'application/json', ...(key ? { 'x-review-key': key } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const env = () => ({ REVIEW_KEY: 'k-test', VOTES: kv() });

test('the votes endpoint refuses a request without the review key', async () => {
  const e = env();
  assert.equal((await onRequestPut({ request: req('PUT', { body: { round: 'r1', pair: 'table', verdict: 'a' } }), env: e })).status, 401);
  assert.equal((await onRequestGet({ request: req('GET', { key: 'wrong', query: '?round=r1' }), env: e })).status, 401);
  assert.equal(e.VOTES.store.size, 0);
});

test('the votes endpoint stores one vote per pair and lists a round', async () => {
  const e = env();
  const put = (body) => onRequestPut({ request: req('PUT', { key: 'k-test', body }), env: e });
  assert.equal((await put({ round: 'r1', pair: 'table', verdict: 'a', reasons: ['clarity'], note: 'cleaner' })).status, 200);
  assert.equal((await put({ round: 'r1', pair: 'table', verdict: 'both' })).status, 200);
  assert.equal((await put({ round: 'r2', pair: 'table', verdict: 'b' })).status, 200);
  const res = await onRequestGet({ request: req('GET', { key: 'k-test', query: '?round=r1' }), env: e });
  const { votes } = await res.json();
  assert.equal(votes.length, 1);
  assert.equal(votes[0].verdict, 'both');
  assert.ok(votes[0].at);
});

test('the votes endpoint refuses a malformed vote', async () => {
  const e = env();
  const put = (body) => onRequestPut({ request: req('PUT', { key: 'k-test', body }), env: e });
  assert.equal((await put({ round: 'r1', pair: 'table', verdict: 'maybe' })).status, 400);
  assert.equal((await put({ round: '../x', pair: 'table', verdict: 'a' })).status, 400);
  assert.equal((await put({ round: 'r1', pair: 'table', verdict: 'a', note: 'x'.repeat(2001) })).status, 400);
  assert.equal(e.VOTES.store.size, 0);
});

test('openTask moves the Net task to Open only when it is in another state', async () => {
  const calls = [];
  const net = (state) => async (url, init = {}) => {
    calls.push([init.method ?? 'GET', url, init.body]);
    return { ok: true, json: async () => ({ id: 'e1', revision: 7, fields: { State: state } }) };
  };
  assert.equal(await openTask({ base: 'https://net.test', token: 't', id: 'e1', fetch: net('Done') }), 'opened');
  assert.deepEqual(calls[1], ['POST', 'https://net.test/api/entities/e1/conditional', JSON.stringify({ expectedRevision: 7, operation: 'state', field: 'State', state: 'Open' })]);
  calls.length = 0;
  assert.equal(await openTask({ base: 'https://net.test', token: 't', id: 'e1', fetch: net('Open') }), 'already open');
  assert.equal(calls.length, 1);
});

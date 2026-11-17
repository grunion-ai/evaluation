const VERDICTS = new Set(['a', 'b', 'both', 'neither']);
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const allowed = (request, env) => Boolean(env.REVIEW_KEY) && request.headers.get('x-review-key') === env.REVIEW_KEY;

const clean = (v) => {
  if (!v || !SLUG.test(v.round ?? '') || !SLUG.test(v.pair ?? '') || !VERDICTS.has(v.verdict)) return null;
  const reasons = v.reasons ?? [];
  const note = v.note ?? '';
  if (!Array.isArray(reasons) || reasons.length > 12 || !reasons.every((r) => SLUG.test(r))) return null;
  if (typeof note !== 'string' || note.length > 2000) return null;
  return { round: v.round, pair: v.pair, verdict: v.verdict, reasons, note };
};

export async function onRequestGet({ request, env }) {
  if (!allowed(request, env)) return json({ error: 'review key required' }, 401);
  const round = new URL(request.url).searchParams.get('round') ?? '';
  if (!SLUG.test(round)) return json({ error: 'round required' }, 400);
  const { keys } = await env.VOTES.list({ prefix: `v:${round}:` });
  const votes = await Promise.all(keys.map(async (k) => JSON.parse(await env.VOTES.get(k.name))));
  return json({ votes });
}

export async function onRequestPut({ request, env }) {
  if (!allowed(request, env)) return json({ error: 'review key required' }, 401);
  const vote = clean(await request.json().catch(() => null));
  if (!vote) return json({ error: 'malformed vote' }, 400);
  const stored = { ...vote, at: new Date().toISOString() };
  await env.VOTES.put(`v:${vote.round}:${vote.pair}`, JSON.stringify(stored));
  return json({ vote: stored });
}

import { readFileSync } from 'node:fs';
const allowed = new Set(Object.values(JSON.parse(readFileSync('tokens.json', 'utf8')).colour).map((c) => c.toLowerCase()));
const html = readFileSync('page.html', 'utf8');
const used = [...html.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toLowerCase());
const named = /\b(rgb|rgba|hsl|hsla)\(/i.test(html);
process.exit(used.length && used.every((c) => allowed.has(c)) && !named ? 0 : 1);

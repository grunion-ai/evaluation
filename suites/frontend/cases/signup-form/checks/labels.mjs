import { readFileSync } from 'node:fs';
const html = readFileSync('index.html', 'utf8');
const fors = new Set([...html.matchAll(/<label\b[^>]*\bfor=["']([^"']+)["']/gi)].map((m) => m[1]));
const inputs = [...html.matchAll(/<input\b[^>]*>/gi)].map((m) => m[0]);
const ok = inputs.length >= 2 && inputs.every((i) => fors.has((i.match(/\bid=["']([^"']+)["']/i) ?? [])[1]));
process.exit(ok ? 0 : 1);

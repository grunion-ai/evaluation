import { readFileSync } from 'node:fs';
const html = readFileSync('index.html', 'utf8');
const inputs = [...html.matchAll(/<input\b[^>]*>/gi)].map((m) => m[0]);
const email = inputs.find((i) => /type=["']?email/i.test(i));
const ok = /<form\b/i.test(html) && email && /\brequired\b/i.test(email) && inputs.filter((i) => /\brequired\b/i.test(i)).length >= 2 && /<button\b[^>]*>\s*Create account\s*<\/button>/i.test(html) && !/<script\b/i.test(html);
process.exit(ok ? 0 : 1);

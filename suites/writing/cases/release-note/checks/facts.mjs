import { readFileSync } from 'node:fs';
const text = readFileSync('release-note.md', 'utf8');
const words = text.trim().split(/\s+/).length;
const ok = /4\.2\.0/.test(text) && /3 March|March 3/.test(text) && /1,000,000|1 million|one million/i.test(text) && words <= 80;
process.exit(ok ? 0 : 1);

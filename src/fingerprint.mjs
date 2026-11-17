import { createHash } from 'node:crypto';

const sorted = (v) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]))
    : Array.isArray(v) ? v.map(sorted) : v;

export const fingerprint = (value) => createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex').slice(0, 16);

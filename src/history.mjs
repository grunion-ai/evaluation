import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fingerprint } from './fingerprint.mjs';

export const SCHEMA_VERSION = 1;

const fileFor = (dir, suite, runId) => join(dir, suite, `${runId}.jsonl`);

export const appendRun = (dir, { header, results }) => {
  const file = fileFor(dir, header.suite, header.runId);
  if (existsSync(file)) throw new Error(`run ${header.runId} exists; history is append-only`);
  mkdirSync(join(dir, header.suite), { recursive: true });
  const head = { type: 'run', schemaVersion: SCHEMA_VERSION, ...header, fingerprint: fingerprint(header.variant ?? {}) };
  const lines = [head, ...results.map((r) => ({ type: 'result', ...r }))];
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { flag: 'wx' });
  return file;
};

export const readRun = (dir, suite, runId) => {
  const lines = readFileSync(fileFor(dir, suite, runId), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { header: lines[0], results: lines.slice(1) };
};

export const listRuns = (dir, suite) => {
  const folder = join(dir, suite);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => readRun(dir, suite, f.slice(0, -6)).header)
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
};

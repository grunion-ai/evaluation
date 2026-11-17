import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const dirs = (folder) => (existsSync(folder) ? readdirSync(folder, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);

export const loadSuites = (root) =>
  dirs(join(root, 'suites')).map((name) => {
    const dir = join(root, 'suites', name);
    const cases = dirs(join(dir, 'cases')).map((id) => ({ dir: join(dir, 'cases', id), spec: json(join(dir, 'cases', id, 'case.json')) }));
    return { dir, suite: json(join(dir, 'suite.json')), cases };
  });

export const loadExperiments = (root) =>
  readdirSync(join(root, 'experiments')).filter((f) => f.endsWith('.json')).map((f) => json(join(root, 'experiments', f)));

export const loadJudges = (root) => json(join(root, 'judges', 'judges.json')).judges;

export const readJsonl = (file) => readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

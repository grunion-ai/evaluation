import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sh = (command, { cwd, env, input, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, env, shell: true, timeout: timeoutMs });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, stdout, timedOut: signal === 'SIGTERM' }));
    child.stdin.end(input ?? '');
  });

export const cliAgent = async ({ prompt, cwd, home, arm, timeoutMs }) => {
  if (arm.config) cpSync(arm.config, join(home, '.claude'), { recursive: true });
  const command = (arm.agent ?? 'claude -p --model {model}').replace('{model}', arm.model ?? '');
  const { code, stdout, timedOut } = await sh(command, { cwd, env: { ...process.env, HOME: home }, input: prompt, timeoutMs });
  if (code !== 0 && !timedOut) throw new Error(`agent command exited ${code}: ${stdout.slice(0, 200)}`);
  return { transcript: stdout, timedOut };
};

export const runTrial = async ({ caseDir, spec, trial, arm, agent = cliAgent }) => {
  const root = mkdtempSync(join(tmpdir(), `eval-${spec.id}-`));
  const cwd = join(root, 'work');
  const home = join(root, 'home');
  mkdirSync(home);
  if (existsSync(join(caseDir, 'fixture'))) cpSync(join(caseDir, 'fixture'), cwd, { recursive: true });
  else mkdirSync(cwd);

  const row = (metric, value, status) => ({ case: spec.id, metric, trial, value, status, split: spec.split });
  const metrics = [...spec.checks.map((c) => c.metric), 'duration_seconds'];
  const failed = (status, extra = {}) => ({ rows: metrics.map((m) => row(m, null, status)), transcript: '', workDir: cwd, ...extra });

  const started = Date.now();
  let out;
  try {
    out = await agent({ prompt: readFileSync(join(caseDir, 'PROMPT.md'), 'utf8'), cwd, home, arm, timeoutMs: spec.timeoutSeconds * 1000 });
  } catch (error) {
    return failed('infra', { error: String(error.message ?? error) });
  }
  if (out.timedOut) return failed('timeout', { transcript: out.transcript });
  const seconds = (Date.now() - started) / 1000;

  if (existsSync(join(caseDir, 'checks'))) cpSync(join(caseDir, 'checks'), join(cwd, 'checks'), { recursive: true });
  const rows = [];
  for (const check of spec.checks) {
    if (!check.command) continue;
    const { code } = await sh(check.command, { cwd, env: process.env, timeoutMs: 120000 });
    rows.push(row(check.metric, code === 0 ? 1 : 0, 'ok'));
  }
  rows.push(row('duration_seconds', seconds, 'ok'));
  return { rows, transcript: out.transcript, workDir: cwd };
};

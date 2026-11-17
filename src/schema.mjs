const KINDS = ['capability', 'regression'];
const METRIC_KINDS = ['code', 'judge'];
const DIRECTIONS = ['up', 'down'];
const ROLES = ['target', 'guard', 'diagnostic'];
const MODES = ['sandbox', 'replay'];
const SPLITS = ['train', 'heldout'];

const oneOf = (errs, where, field, value, allowed) => {
  if (!allowed.includes(value)) errs.push(`${where}: ${field} must be one of ${allowed.join(', ')}`);
};
const required = (errs, where, obj, fields) => {
  for (const f of fields) if (obj[f] === undefined || obj[f] === '') errs.push(`${where}: ${f} is required`);
};

export const validateSuite = (suite) => {
  const errs = [];
  const where = `suite ${suite.name ?? '?'}`;
  required(errs, where, suite, ['schemaVersion', 'name', 'metrics']);
  oneOf(errs, where, 'kind', suite.kind, KINDS);
  for (const m of suite.metrics ?? []) {
    const at = `${where} metric ${m.name ?? '?'}`;
    required(errs, at, m, ['name', 'unit']);
    oneOf(errs, at, 'kind', m.kind, METRIC_KINDS);
    oneOf(errs, at, 'direction', m.direction, DIRECTIONS);
    oneOf(errs, at, 'role', m.role, ROLES);
    if (m.kind === 'judge' && !m.judge) errs.push(`${at}: judge is required for a judge metric`);
    if (m.kind === 'code' && !m.scorer) errs.push(`${at}: scorer is required for a code metric`);
  }
  if ((suite.metrics ?? []).filter((m) => m.role === 'target').length !== 1) errs.push(`${where}: exactly one target metric`);
  return errs;
};

export const validateCase = (c, suite) => {
  const errs = [];
  const where = `case ${c.id ?? '?'}`;
  required(errs, where, c, ['schemaVersion', 'id', 'source']);
  oneOf(errs, where, 'mode', c.mode, MODES);
  oneOf(errs, where, 'split', c.split, SPLITS);
  if (c.mode === 'sandbox') {
    if (!(c.trials >= 3)) errs.push(`${where}: trials must be 3 or more`);
    if (!(c.timeoutSeconds > 0)) errs.push(`${where}: timeoutSeconds is required`);
  }
  const names = new Set(suite.metrics.map((m) => m.name));
  for (const check of c.checks ?? []) if (!names.has(check.metric)) errs.push(`${where}: check names unknown metric ${check.metric}`);
  return errs;
};

export const validateExperiment = (e) => {
  const errs = [];
  const where = `experiment ${e.name ?? '?'}`;
  required(errs, where, e, ['schemaVersion', 'name', 'suite', 'axis', 'baseline', 'candidate']);
  if (e.baseline && e.candidate) {
    const keys = new Set([...Object.keys(e.baseline), ...Object.keys(e.candidate)]);
    const changed = [...keys].filter((k) => JSON.stringify(e.baseline[k]) !== JSON.stringify(e.candidate[k]));
    if (changed.length !== 1 || changed[0] !== e.axis) errs.push(`${where}: arms must differ on one axis (${e.axis}), found ${changed.join(', ') || 'none'}`);
  }
  return errs;
};

export const validateSizes = (doc) => {
  const errs = [];
  required(errs, 'sizes', doc, ['schemaVersion', 'sizes']);
  for (const [name, size] of Object.entries(doc.sizes ?? {})) {
    const where = `size ${name}`;
    required(errs, where, size, ['cases', 'trials', 'heldout', 'caps']);
    if (!(size.trials >= 3)) errs.push(`${where}: trials must be 3 or more`);
    required(errs, where, size.caps ?? {}, ['fiveHourPct', 'weeklyPct']);
  }
  return errs;
};

export const parseVerdict = (text) => {
  const m = String(text).match(/<verdict>\s*(pass|fail|unknown)\s*<\/verdict>/i);
  return m ? m[1].toLowerCase() : 'unknown';
};

export const vote = (verdicts) => {
  for (const v of ['pass', 'fail']) if (verdicts.filter((x) => x === v).length >= 2) return v;
  return 'unknown';
};

export const agreement = (pairs) => {
  const rate = (label) => {
    const rows = pairs.filter((p) => p.label === label);
    return rows.length ? rows.filter((p) => p.verdict === label).length / rows.length : null;
  };
  return { n: pairs.length, tpr: rate('pass'), tnr: rate('fail') };
};

export const trusted = ({ n, tpr, tnr }, { bar = 0.8, minLabels = 20 } = {}) => n >= minLabels && tpr >= bar && tnr >= bar;

export const pairwise = (forward, reverse) => {
  const pick = (r) => r[r.winner];
  return pick(forward) === pick(reverse) ? pick(forward) : 'tie';
};

export const judgePrompt = ({ rubric, output, task = '' }) => `You grade one output against one rubric. Judge only what the rubric names.

<task>
${task}
</task>

<rubric>
${rubric}
</rubric>

<output>
${output}
</output>

Reason inside <thinking> tags. Then answer with exactly one of <verdict>PASS</verdict>, <verdict>FAIL</verdict> or <verdict>UNKNOWN</verdict>. Answer UNKNOWN when the output gives too little to decide.`;

export const runJudge = async ({ rubric, output, task, model, ask, votes = 3 }) => {
  const prompt = judgePrompt({ rubric, output, task });
  const replies = await Promise.all(Array.from({ length: votes }, () => ask({ prompt, model })));
  const verdicts = replies.map(parseVerdict);
  return { verdict: vote(verdicts), verdicts, replies };
};

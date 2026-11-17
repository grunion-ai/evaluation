# evaluation

evaluation runs an AI coding agent against fixed cases, or scores sessions you already ran, and tells you whether a change (a skill, an agent, a model or a writing framework) made the agent better or worse.

## Suites

Each suite has one target metric, which you want to improve. A guard metric must not regress. A diagnostic metric is recorded and never gated.

| Suite | What a case asks for | Target metric | Guard metrics |
| --- | --- | --- | --- |
| harness | A coding task in a repo that carries a standing instruction | `completion` | `instruction_followed`, `duration_seconds` |
| backend | A bug fix in a small Node module | `hidden_tests` | `existing_tests`, `duration_seconds` |
| frontend | A page built to a spec, such as a sign-up form with native validation | `behaviour` | `labels`, `duration_seconds` |
| writing | Customer prose from a facts file, such as a release note under 80 words | `leads_with_change` | `plain_words`, `facts_kept` |
| design | A page held to a design token file, such as a status page | `visual_hierarchy` | `token_colours` |
| harness-sessions | No case: each row is a session you already ran | `completion` | `active_minutes`, `cost_usd` |

## Modes

Replay scores sessions you already ran. You export them as JSONL, one session per line, and each field-scored metric reads its value from that line; a missing field is unknown, never zero.

Sandbox runs an experiment, which sets two arms (a baseline and a candidate, each one set of agent settings) against one suite. Each case runs in a fresh directory under a temporary home, three or more trials per case. The agent sees the prompt and the starting files (the fixture); the case's checks are copied in after it finishes.

## Metrics

A code metric is a command's exit code (0 scores 1, anything else scores 0), a duration in seconds or a field from an exported session.

A judge metric asks a model to grade one output against a binary rubric that covers one dimension, and two of three votes must agree or the result is unknown. Each judge runs on a pinned model; `run` refuses an experiment whose model under test is the judge's model. A judge is untrusted, and its metric diagnostic, until `calibrate` scores it on 20 or more human-labelled examples marked `test` with true positive and true negative rates of 0.8 or higher.

## Run history

Each run writes one append-only JSONL file under `history/<suite>/`. The first line is the run header, with a fingerprint of the arm's settings; every later line is one result.

## Run sizes

`run --size small|medium|large` picks how many cases and trials a sandbox run uses, from `sizes.json`; the default is `small`. Each size also caps the run's share of your plan's 5-hour and weekly usage windows.

| Size | Cases | Trials per case | Held-out cases | 5-hour cap | Weekly cap |
| --- | --- | --- | --- | --- | --- |
| small | 5 | 3 | no | 10% | 1% |
| medium | 20 | 3 | no | 40% | 4% |
| large | 50 | 5 | yes | 80% | 15% |

Before any trial starts, a budget guard estimates the run's tokens from past runs of the suite. It refuses a run that would exceed a cap or push either window past 90% used. The runner cannot read plan limits itself, so you pass current usage with `--five-hour-used` and `--weekly-used`. Only a small run may start with no estimate or no `calibrate-budget` measurement. A run that passes the token allowance its caps imply stops before its next trial and is marked partial; `compare` refuses partial runs.

## Comparison and the gate

`compare` pairs the baseline and candidate runs by case and takes a 95% interval on the mean difference from a t distribution. Pass two runs of the same arm with `--aa`; the larger absolute end of the interval on their paired difference becomes the noise floor.

Each metric gets a verdict. It is `improved` or `regressed`, by the metric's direction, when the interval excludes zero and the difference exceeds the noise floor. It is `noise` when it does not, and `unknown` when the two runs share no case.

The gate is `revise` when the target or any guard regressed, and `ship` when the target improved and no guard is unknown. Otherwise it is `hold`: the target shows no clear change, or a guard has no verdict.

## Quick start

Node 22 or later, no dependencies.

```sh
node src/cli.mjs validate
node src/cli.mjs replay harness-sessions <sessions.jsonl> --run-id <id> --arm <label>
node src/cli.mjs run <experiment> --size small --five-hour-used <pct> --weekly-used <pct>
node src/cli.mjs calibrate-budget <suite> <run-id> --five-hour-before <pct> --five-hour-after <pct> --weekly-before <pct> --weekly-after <pct>
node src/cli.mjs compare <suite> <baseline-run> <candidate-run> [--aa <runA> --aa <runA2>] [--split heldout]
node src/cli.mjs calibrate <judge>
npm test
```

## Status

The test suite covers the code checks, the replay path, comparison and the gate. Live sandbox runs and live judge calls shell out to the `claude` CLI and need `ANTHROPIC_API_KEY`; they have not been exercised end to end yet.

Every judge ships with an empty labels file, so every judge metric is diagnostic until someone labels examples and runs `calibrate`. Until then the writing and design suites, whose targets are judge metrics, reach `hold` at best.

The caps in `sizes.json` are starting values that no measured run has confirmed, and `budget/calibration.json` stays empty until a small run is calibrated.

Each of the five sandbox suites has one seed case, and `docs/sources.md` lists the evaluation practices the repo has not adopted yet.

## Further reading

- Data shapes and rules: [docs/design.md](docs/design.md)
- Practices and their sources: [docs/sources.md](docs/sources.md)

## License

MIT. See [LICENSE](LICENSE).

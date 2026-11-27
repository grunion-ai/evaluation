# Design

This page lists each data shape in the repo and the rules `src/` enforces on it. `node src/cli.mjs validate` checks every suite, case and experiment against these rules.

## Suite file

Each `suites/<suite>/suite.json` names the suite, its kind and its metrics.

```json
{
  "schemaVersion": 1,
  "name": "backend",
  "kind": "capability",
  "metrics": [
    { "name": "hidden_tests", "kind": "code", "scorer": "command", "direction": "up", "unit": "rate", "role": "target" },
    { "name": "existing_tests", "kind": "code", "scorer": "command", "direction": "up", "unit": "rate", "role": "guard" },
    { "name": "duration_seconds", "kind": "code", "scorer": "duration", "direction": "down", "unit": "seconds", "role": "guard" }
  ]
}
```

`kind` is `capability` or `regression`; `src/` validates it and does not act on it. Each metric takes `name`, `unit`, `kind` (`code` or `judge`), `direction` (`up` when a higher value is better, `down` when a lower one is) and `role` (`target`, `guard` or `diagnostic`). A code metric needs a `scorer`: `command`, `duration` or `field`, and a `field` scorer names the session field it reads. A judge metric names its `judge`. A suite has exactly one target metric.

## Case directory

A case lives in `suites/<suite>/cases/<id>/`:

- `case.json`: the case spec.
- `PROMPT.md`: the task the agent receives.
- `fixture/`: the starting files, copied into the agent's working directory.
- `checks/`: the check scripts, withheld from the agent until it finishes.
- `solution/`: a reference solution that passes every code check.

```json
{
  "schemaVersion": 1,
  "id": "paginate-last-page",
  "mode": "sandbox",
  "split": "train",
  "trials": 3,
  "timeoutSeconds": 600,
  "source": "Seed case: off-by-one in page count drops the final partial page",
  "checks": [
    { "metric": "hidden_tests", "command": "node checks/hidden.mjs" },
    { "metric": "existing_tests", "command": "node --test test/" }
  ]
}
```

Fields in `case.json`:

- `mode`: `sandbox` or `replay`.
- `split`: `train` or `heldout`. `compare --split heldout` compares only rows from `heldout` cases.
- `trials` and `timeoutSeconds`: a sandbox case needs 3 or more trials and a timeout.
- `source`: where the case came from. Each seed case names the failure it targets.
- `checks`: each names a suite metric and either a `command` or a `judge` with the `output` file it grades, as in `{ "metric": "plain_words", "judge": "plain-words", "output": "release-note.md" }`. A missing output file scores 0.

## Result rows

Each result row records `case`, `metric`, `trial`, `value`, `status` and `split`, with an optional `evidence` string. The status is one of four:

- `ok`: the trial ran and the value counts.
- `infra`: the agent command failed to start or exited non-zero before its timeout.
- `timeout`: the agent ran past `timeoutSeconds`.
- `unknown`: the value could not be decided, such as a missing session field or a judge vote with no majority.

Every status other than `ok` carries a null value, and the comparison drops those rows.

## Run header

The first line of a run file is the header: `type: "run"`, `schemaVersion`, `runId`, `suite`, `mode`, `arm`, `startedAt`, `variant` and `fingerprint`. For a sandbox run, `variant` is the arm's settings and the header adds `experiment` and `finishedAt`; for a replay, `variant` is the `--variant` JSON. `fingerprint` is the first 16 hex characters of a SHA-256 hash of the variant with its keys sorted, so two runs with the same fingerprint used the same settings. Reusing a run id throws an error.

## Experiment files

An experiment in `experiments/` names a suite, an axis and two arms, a baseline and a candidate; each arm is one set of agent settings. The axis is the one arm key that differs between baseline and candidate, such as `model` or `config`; `validate` rejects an experiment whose arms differ on any other key.

```json
{
  "schemaVersion": 1,
  "name": "skill-added-harness",
  "suite": "harness",
  "axis": "config",
  "baseline": { "model": "claude-sonnet-5-5", "config": "configs/baseline" },
  "candidate": { "model": "claude-sonnet-5-5", "config": "configs/candidate" }
}
```

An arm's `config` directory is copied into `.claude` under the trial's temporary home. The agent command defaults to `claude -p --model {model}`, and an arm can set its own with `agent`.

## Judge files

`judges/judges.json` maps each judge to its pinned model, vote count, rubric and labels file:

```json
"plain-words": { "model": "claude-opus-5-5", "votes": 3, "rubric": "plain-words.md", "labels": "plain-words.labels.jsonl" }
```

The rubric states when to answer PASS and when to answer FAIL, and names what the judge ignores. The judge may also answer UNKNOWN when the output gives too little to decide. The labels file holds one JSON object per line with `output`, `label` (`pass` or `fail`), `split` and an optional `task`. `calibrate` grades the rows whose split is `test` and writes `judges/<judge>.calibration.json` with `judge`, `model`, `at`, `n`, `tpr` (true positive rate), `tnr` (true negative rate) and `trusted`. `n` counts the test rows, and `trusted` is true when `n` is 20 or more and both rates reach 0.8.

## Verdicts and the gate

`src/compare.mjs` averages each case's `ok` rows, then pairs the baseline and candidate by case. For each metric:

1. No shared case: `unknown`.
2. A 95% interval on the paired mean difference that includes zero, or a mean difference no larger than the noise floor: `noise`.
3. Otherwise `improved` for a gain and `regressed` for a loss, by the metric's direction.

The noise floor is the larger absolute end of that interval taken between two runs of one arm (`--aa`), and 0 without them.

A judge metric whose judge is untrusted takes the diagnostic role. The gate then reads the target and guard verdicts as the README describes. A suite whose target is an untrusted judge metric has no target, so its gate is `hold` or `revise`. `compare` exits 1 on `revise`.

## Sizes and the budget guard

Each size in `sizes.json` sets its case count, trial count and percent cap per usage window:

```json
"small": { "cases": 5, "trials": 3, "heldout": false, "caps": { "fiveHourPct": 10, "weeklyPct": 1 } }
```

`run` sorts the suite's sandbox cases by id, drops `heldout` cases unless the size sets `heldout`, keeps the first `cases` and runs each for the size's `trials`.

Each trial records `tokens` (the input, output, cache-creation and cache-read counts in `usage`) and `cost_usd` (`total_cost_usd`) from the agent CLI's JSON output. Non-JSON output leaves both `unknown`, a missing `usage` block leaves `tokens` `unknown`, and a missing `total_cost_usd` leaves `cost_usd` `unknown`.

The estimate is the mean of the `ok` `tokens` rows in the suite's past runs, times the planned trials. `calibrate-budget` divides a finished run's `tokens` by the points each window moved between the before and after percentages, and stores tokens per percent for that run's model in `budget/calibration.json`. A window that did not move keeps its earlier rate or stays unset. `calibrate-budget` refuses a partial run. The guard divides the estimate by each stored rate and refuses the run when that share passes its cap or takes the window past 90% used. The token allowance is the smaller of rate times cap across the two windows; a run that spends past it stops before its next trial and sets `partial`.

The run header adds `size`, `partial`, `tokens` (spent), `estimate` and `uncalibrated` (true when the guard had no estimate or stored rate).

## Adding a case

1. Write `checks/`, and a `fixture/` that fails at least one check.
2. Write `solution/` so that it passes every code check.
3. Write `case.json` and `PROMPT.md`, then run `npm test` and `node src/cli.mjs validate` (`test/cases.test.mjs` checks both conditions for every case).

## Adding a judge

1. Write a binary rubric for one dimension in `judges/<judge>.md`.
2. Add an entry to `judges/judges.json` on a model different from any model under test.
3. Label 20 or more examples with `split` set to `test` in the labels file and run `node src/cli.mjs calibrate <judge>`.

## Rule rows

The `harness-rules` suite holds the harness rule eval. The harness counts; this repo keeps the history. `node src/cli.mjs replay harness-rules <rows.jsonl> --history <dir>` takes one line per session:

```json
{ "id": "<session id>", "at": "2026-11-27T10:00:00Z", "track": "interactive", "harness": "<commit sha>", "harnessAt": "2026-11-27T09:00:00Z", "response": { "checked": 8, "exempt": 1, "waivers": 2, "exceptions": 2 }, "outcome": { "checked": 1, "exempt": 0, "waivers": 0, "exceptions": 0 }, "log": { "checked": 1, "exempt": 0, "waivers": 0, "exceptions": 0 }, "untyped": { "checked": 3, "exempt": 0, "waivers": 0, "exceptions": 0 } }
```

A metric with `"scorer": "rule"` reads the object named by `field`. Its value is exceptions over checked, and a session with nothing checked is `unknown` with a null value. The result row keeps `checked`, `exempt`, `waivers` and `exceptions` as separate fields, so a waiver or an exempt unit never enters the rate, plus `at` (session start), `track` (`interactive` or `automated`), `harness` (the harness commit live when the session started) and `harnessAt` (that commit's time).

# evaluation

Cases, metrics, judges and run history for evaluating AI coding agents across five suites: harness, backend, frontend, writing and design.

## Build and run

- Install: none. Node 22 or later, zero dependencies.
- Validate every suite, case and experiment: `node src/cli.mjs validate`
- Score exported sessions: `node src/cli.mjs replay harness-sessions <sessions.jsonl> --run-id <id> --arm <label>`
- Run an experiment in sandboxes: `node src/cli.mjs run <experiment> --size small --five-hour-used <pct> --weekly-used <pct>` (needs `ANTHROPIC_API_KEY`; each trial runs under a temporary home)
- Store tokens per percent after a run: `node src/cli.mjs calibrate-budget <suite> <run-id> --five-hour-before <pct> --five-hour-after <pct> --weekly-before <pct> --weekly-after <pct>`
- Compare two runs: `node src/cli.mjs compare <suite> <baseline-run> <candidate-run> [--aa <runA> --aa <runA2>] [--split heldout]`
- Calibrate a judge against its labels: `node src/cli.mjs calibrate <judge>`

## Test

- Suite: `npm test`
- Gates before a push: `npm test` green and `node src/cli.mjs validate` prints `ok`.
- Tests come first. A new case lands with a `solution/` that passes every code check and a fixture that fails at least one; `test/cases.test.mjs` proves both.

## Rules

- `history/` is append-only. A run file is never edited or deleted; a rerun gets a new run id.
- An experiment's two arms differ on one axis.
- A judge is binary, covers one dimension, runs on a pinned model different from the model under test, and gates nothing until `calibrate` marks it trusted.
- Infra failures, timeouts and unknown verdicts carry a null value. Unknown is never zero.
- A medium or large run needs a calibrated small run first. A run that passes its token allowance stops and is marked partial; partial runs stay out of comparisons.
- No inline comments in code. The why goes in the commit message.

## Ship

- Branch per change, pull request, squash merge once `npm test` is green.

## Pointers

- Design and data shapes: `docs/design.md`
- Practices and their sources: `docs/sources.md`

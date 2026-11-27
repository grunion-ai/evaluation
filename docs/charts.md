# Chart templates

A chart template is one JSON file in `charts/`. The `charts` command reads history, fills every template it is asked for and writes one HTML page. The page needs no network and no script, and follows the reader's light or dark setting.

```
node src/cli.mjs charts --list
node src/cli.mjs charts --out report.html
node src/cli.mjs charts token-weighted-outcome exception-rate-by-type --out report.html
node src/cli.mjs charts case-by-arm-grid --suite writing --baseline <run> --candidate <run> --out ab.html
node src/cli.mjs charts judge-agreement-matrix --pairs <labels.jsonl> --out judge.html
node src/cli.mjs charts judge-agreement-matrix --pairs <labels.jsonl> --param verdict=judge.reads_human --out judge.html
```

## Spec

| Field | Holds |
| --- | --- |
| `id` | File name without `.json`, used on the command line |
| `title` | Noun phrase shown above the chart |
| `question` | The one question the chart answers, shown under the title |
| `form` | How it is drawn: `findings`, `doughnut`, `line`, `stacked-bar`, `dot-grid`, `heat-grid`, `scorecard`, `tiles`, `case-grid`, `agreement-matrix` |
| `builder` | Which function in `src/charts.mjs` turns history rows into the data the form draws |
| `params` | Arguments for the builder: `metrics`, `track`, `metric`, `last`, field paths |
| `order` | Position on the page; lower comes first, and the first chart spans the page width |
| `default` | `false` keeps a template in the library and off the page drawn when no id is given |

`--param key=value` overrides one of a spec's `params` for a single run, and can be given more than once.

`validate` refuses a spec with a missing field, an unknown form or an unknown builder.

## Templates

| Id | Form | Reads |
| --- | --- | --- |
| `last-eval` | findings | The newest `harness-rules` run, each rule type against the eval before it |
| `token-spend-by-project` | doughnut | The last 90 sessions: `tokens`, outcome and `dims.project` |
| `token-weighted-outcome` | line | `harness-rules` outcome rows and the `tokens` metric |
| `exception-rate-by-type` | line | `harness-rules` rows for each rule type |
| `weekly-tokens-by-outcome` | stacked-bar | `harness-rules` outcome rows and the `tokens` metric |
| `exception-dot-grid` | dot-grid | `harness-rules` totals per rule type |
| `turn-by-context-grid` | heat-grid | `harness-turns` rows with `dims.turn` and `dims.context` |
| `rule-scorecard` | scorecard | `harness-rules` rows, weighted rate and its path |
| `headline-tiles` | tiles | `harness-rules` rows, kept share per rule type |
| `case-by-arm-grid` | case-grid | Two runs of one suite, named on the command line |
| `judge-agreement-matrix` | agreement-matrix | A labels file with a human label and a judge verdict per line |

## The dashboard

`charts` with no id draws the dashboard: every template whose spec does not say `"default": false`, in `order`. Today that is the last eval, exception rate by rule type, the rule scorecard, token-weighted outcome, token spend by project, the exception dot grid and the judge agreement matrix. The other four stay in the library and draw when named.

The last eval block compares each rule type with the newest run from an earlier day. With no earlier run it compares with the rate 30 scored sessions back and says so.

## Adding a template

1. Reuse a form and a builder when they fit: copy a spec, change `id`, `title`, `question` and `params`.
2. For a new view of the data, add a builder to `BUILDERS` in `src/charts.mjs`. It takes the history context and the spec's `params` and returns plain data, or `{ missing: "<reason>" }`.
3. For a new drawing, add a form to `FORMS`. It takes the builder's data and returns HTML or inline SVG.
4. Write the test first in `test/charts.test.mjs`, then run `npm test` and `node src/cli.mjs validate`.

## Rules the charts keep

- A chart with no data says why and draws nothing. Unknown is never zero.
- A weighted rate uses the half-life from `src/rules.mjs` and stays hidden until enough sessions are scored.
- A grid cell under 10 units shows its count and no rate.
- Waived and exempt units stay out of every exception rate and are counted beside it.

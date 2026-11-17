# Practices and sources

Each rule in this repo traces to a published practice. Pages were read on 17 November 2026.

| Practice | Where it lives here | Source |
| --- | --- | --- |
| Paired differences on identical cases, clustered on the case | `src/stats.mjs` `caseMeans`, `pairedDiff` | [A statistical approach to model evals](https://arxiv.org/abs/2411.00640) |
| Wider intervals for small samples | `src/stats.mjs` `tCrit` | [Bowyer et al., 2025](https://arxiv.org/abs/2503.01747) |
| Noise floor from two runs of one configuration, checked before any gate | `src/stats.mjs` `noiseFloor`, `compare --aa` | [Automating eval design and hillclimbing](https://claude.dev/blog/automating-eval-design-and-hillclimbing/) |
| Train and held-out splits | `split` in `case.json`, `compare --split` | [Automating eval design and hillclimbing](https://claude.dev/blog/automating-eval-design-and-hillclimbing/) |
| Three or more trials per case, pass^k beside the pass rate | `src/schema.mjs`, `src/stats.mjs` `passHatK` | [claude plugin eval](https://code.claude.com/docs/en/plugin-evals), [tau-bench](https://arxiv.org/abs/2406.12045) |
| Capability and regression suites | `kind` in `suite.json` | [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) |
| A reference solution per case; a case nothing passes is a broken case | `solution/`, `test/cases.test.mjs` | [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), [Harbor tasks](https://docs.harborframework.com/tasks/overview) |
| Case as a directory: prompt, fixture, withheld checks | `suites/<suite>/cases/<id>/` | [vercel-labs/agent-eval](https://github.com/vercel-labs/agent-eval) |
| One file per experiment, arms differ on one axis | `experiments/`, `validateExperiment` | [AGENTS.md outperforms skills](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals) |
| Infra failures and timeouts counted apart from model failures | `status` on every result row | [Quantifying infrastructure noise](https://www.anthropic.com/engineering/infrastructure-noise), [SWE-bench evaluation](https://www.swebench.com/SWE-bench/guides/evaluation/) |
| Unknown is never zero | `src/runners/replay.mjs` | [nextjs.org/evals](https://nextjs.org/evals) |
| Config fingerprint on every run | `src/fingerprint.mjs` | [vercel/next-evals-oss](https://github.com/vercel/next-evals-oss) |
| Immutable run logs with a schema version | `src/history.mjs` | [Inspect eval logs](https://inspect.aisi.org.uk/eval-logs.html) |
| Hermetic trials under a temporary home | `src/runners/sandbox.mjs` | [claude plugin eval](https://code.claude.com/docs/en/plugin-evals) |
| Binary judges, one dimension each, with an Unknown verdict | `judges/*.md`, `src/judge.mjs` | [Product evals](https://eugeneyan.com/writing/product-evals/), [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) |
| Two of three judge votes | `vote` | [claude plugin eval](https://code.claude.com/docs/en/plugin-evals) |
| Judges validated on held-out human labels, true positive and true negative rates reported | `calibrate`, `agreement`, `trusted` | [Using LLM-as-a-judge](https://hamel.dev/blog/posts/llm-judge/) |
| Judge on a different model from the one under test | `run` refuses a clash | [Panickssery et al., 2024](https://arxiv.org/abs/2404.13076) |
| Pairwise judging in both orders, a flip counts as a tie | `pairwise` | [Evaluating LLM evaluators](https://eugeneyan.com/writing/llm-evaluators/), [EQ-Bench](https://eqbench.com/about.html) |
| Diagnostic metrics recorded and never gated | `role: diagnostic` | [promptfoo assertions](https://www.promptfoo.dev/docs/configuration/expected-outputs/) |
| Cases come from observed failures and name them | `source` in `case.json` | [Evals FAQ](https://hamel.dev/blog/posts/evals-faq/) |
| Named-failure counts and frozen scenarios for visual work | `suites/design` | [design.md evals](https://vercel.com/blog/how-our-agents-build-on-brand-pages-with-design-md) |

## Not adopted yet

- Screenshot judging, pixel diffs and axe checks for the frontend and design suites. The seed cases check markup and CSS source.
- Bayesian intervals. `tCrit` widens small-sample intervals; it does not replace them.
- Correcting pass rates by a judge's measured error rates.
- Cost per run from transcript token counts.

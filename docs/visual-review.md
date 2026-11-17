# Visual review

Kyle picks between two options made for the same objective. His picks train `glyph-taste` and the visual judges that follow it, and the loop runs until a judge matches every pick in a round.

## Parts

- `visual/taxonomy.json`: the four verdicts (`a`, `b`, `both`, `neither`), the media a round can cover, the production axes an option records (`model`, `effort`, `skill`, `colorToken`, `construction`, `intent`) and the reasons Kyle can attach to a pick.
- `visual/rounds/<id>/round.json`: one round. It names the medium and the context every option renders in. Each pair carries a `subject`, the `objective` both agents received, the `axis` that differs, and two options with the `arm` that made each, its file and the agent's stated intent.
- `visual/site/`: the review page (`public/index.html`), the votes endpoint (`functions/api/votes.js`) and the Cloudflare Pages config. `review.json` holds the live address and the Net task.
- `judges/glyph-taste.md`: the rubric. `visual/rounds/<id>/votes.jsonl` holds Kyle's picks and `judge.jsonl` holds the judge's.

## Rules

- The two options of a pair differ on one axis. `validate` refuses a pair that differs on none or on two.
- The page hides how each option was made until Kyle picks. The judge never sees it.
- Options are SVG with no script, image, link or outside reference. `validate` refuses anything else.
- The votes endpoint needs the review key in the `x-review-key` header. The key lives in Keychain under service `visual-review`, account `kyle`, and in the Pages secret `REVIEW_KEY`.
- A rubric change is a new version of the rubric file in its own commit, with the picks that caused it named in the message.

## Loop

1. Add `visual/rounds/<id>/round.json` and its option files. Run `node src/cli.mjs validate`.
2. Build and deploy: `node src/cli.mjs visual-build`, then from `visual/site` run `npx wrangler pages deploy public --project-name grunion-visual-review`.
3. Reopen the Net task: `node src/cli.mjs visual-notify <id>` sets it to Open when the round has pairs with no pick. It needs `REVIEW_KEY` and `WEAVE_NET_TOKEN`.
4. Record the judge's picks before reading Kyle's: `node src/cli.mjs visual-judge <id>`.
5. After Kyle reviews: `node src/cli.mjs visual-pull <id>` writes `votes.jsonl`.
6. `node src/cli.mjs visual-agree <id>` prints the match rate, the misses and the rate per axis. It exits 0 only when every pair is picked and matched.
7. Read the misses and Kyle's reasons and notes, revise the rubric, and queue the next round on the axes where the judge missed.

## Local run

From `visual/site`, write `REVIEW_KEY=<any test value>` to `.dev.vars` and run `npx wrangler pages dev public`. Votes land in a local store.

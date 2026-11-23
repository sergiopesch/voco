# deepsec workspace for VOCO

This folder is a [deepsec](https://github.com/vercel-labs/deepsec) workspace:
an agent-powered vulnerability scanner, here pointed at the repository above
it. `review.sh` is how it runs for VOCO. Read it before running anything else.

## Running a review

```bash
DEEPSEC_ANTHROPIC_API_KEY=... .deepsec/review.sh
```

- The key is the maintainer's own Anthropic API key, named by
  `DEEPSEC_ANTHROPIC_API_KEY` (`ai.apiKeyEnv` in `deepsec.config.ts`). Never
  name it `ANTHROPIC_API_KEY`: Claude Code itself reads that name. Never print
  it, write it to a file or pass it on a command line.
- `review.sh` runs deepsec in a clean environment with a home of its own.
  Inside a Claude Code session, deepsec's agent would otherwise inherit that
  session's model route and identity and use them in place of the key. Run
  every deepsec command through `review.sh deepsec <arguments>` for that reason.
- Spending stops at `DEEPSEC_BUDGET_USD`, 50 unless set. deepsec's `process`
  has no limit of its own; the script reviews five files at a time and checks
  what deepsec recorded as spent before each five, so it can overshoot by the
  cost of one such step. A hard limit belongs on the key, in Anthropic's
  console. Raise the budget only when the maintainer says so.
- `npx deepsec init`, deepsec's one-shot setup, needs a Vercel login even with
  a key of your own. Don't run it here, and never start a login.
- The pattern scan (`scan`) is free and local. It has no patterns for Rust, so
  `first-pass.txt` lists the files to review by path, highest risk first:
  the installer and update path, the local sockets and D-Bus, the browser
  field, the paste path, the worker sandbox, then the extensions.

## After a review

```bash
.deepsec/review.sh deepsec export --project-id voco --format md-dir --out ./findings
```

`findings/` and everything under `data/voco/` except `INFO.md` are ignored by
Git: findings may describe a vulnerability before it is fixed, so they never
go into a commit, a pull request or an issue. Treat each finding as a claim to
check: read the code it names, reproduce it where that is possible, write the
cause down, then fix it with a test, as [AGENTS.md](../AGENTS.md) asks of any
report. `revalidate` re-checks findings for the cost of another review.

`data/voco/INFO.md` is VOCO's threat model as every review batch reads it.
Keep it under 100 lines, and update it when the trust boundaries change.

## Reference

After `npm ci` here, deepsec's own documentation for the installed version is
at `node_modules/deepsec/SKILL.md` and `node_modules/deepsec/dist/docs/`.

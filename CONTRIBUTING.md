# Contributing

Thanks for looking into AGBoss. The short version: every change starts as a GitHub Issue, moves
through a fixed conveyor, and lands via a squash-merged PR. Full detail lives in `WORKFLOW.md` and
`QUALITY.md` — this file is the quick path to your first PR.

## Before you start

1. Read `WORKFLOW.md` (tracker, branches, PRs) and `QUALITY.md` (code, types, tests, FinOps).
2. `make setup` — installs dependencies (npm workspaces).
3. `make check` — the gate: build + API reports + compiled docs + format + lint + typecheck +
   coverage. Run it before opening a PR; CI runs it again.

## Finding or filing an issue

Work items, specs and implementation plans live in GitHub Issues, not as files in the repo. If
nothing covers what you want to do, open an issue first — describe why, what it does, what it does
not do, and any constraints you're aware of. Maintainers triage it onto the board
(`Triage → Backlog → In progress → Test → Done`).

Labels: `type:feature` · `type:bugfix` · `type:chore` · `type:epic` · `prio:mvp` · `prio:stretch` ·
`blocked`. Board status (not a label) tracks the stage.

## Branching and commits

```
main                      ← default; always releasable; PR target
feat/<issue>-<slug>       ← e.g. feat/182-typed-environments
fix/<issue>-<slug>        ← e.g. fix/186-batch-parallel
chore/<issue>-<slug>      ← e.g. chore/167-rebrand-agboss
docs/<issue>-<slug>
spike/<issue>-<slug>      ← experiments, never merged as is
```

- Branch from `main`, never commit to `main`/`staging`/`production` directly.
- Conventional commits with the issue number: `feat(#12): …`, `fix(#13): …`, `test(#12): …`,
  `chore(#14): …`. Small commits are fine — the PR is squash-merged.

## Pull requests

- Base: `main`. Title: `<type>-<issue>: <issue title>`.
- Body follows `.github/pull_request_template.md` and says **`Refs #<issue>`** — never `Closes`:
  merging doesn't close the issue, acceptance happens later, in Test.
- One PR per issue. No drive-by changes outside the issue's scope — open a new issue instead.
- Merge: squash, delete branch, only after `make check` / CI is green.

## Definition of Done

- [ ] Every acceptance criterion is proven by a passing test or a documented manual check
- [ ] `make check` green (types, lint, format, coverage ≥ 80%)
- [ ] Self-review against `QUALITY.md` done
- [ ] Wiki updated if the change touches public API, DSL or architecture (`scripts/wiki.sh`)
- [ ] PR merged; issue moved to **Test**; a manual-acceptance checklist posted on the issue

**Done** is a maintainer's call, after the manual checklist passes — never set by a merge alone.

## Naming and style

New names follow the project's naming grammar (`CLAUDE.md` → Naming grammar): kind as the suffix,
qualifier in front, full words over abbreviations (the framework keeps `DTO`, `PII`, `MCP`, `RAG`,
`JSON`, `CSV`, `CLI`, `URL`, `ID`, `API` and the CLI command itself). Code style is enforced by
`make check` (ESLint + Prettier) — don't hand-format (`make fmt`), don't disable a rule to get
green; fix the code or open an issue explaining why the rule doesn't fit. Flow chains have one call
per line (#289): `*.workflow.ts` modules and the flow fixtures are formatted by `make fmt` instead of
Prettier and checked by ESLint (`@stylistic/newline-per-chained-call`, `scripts/flow-style.mjs`),
the docs' flow snippets by `npm run check:docs`.

## Questions

Open a GitHub Issue — including for questions that aren't yet a concrete change.

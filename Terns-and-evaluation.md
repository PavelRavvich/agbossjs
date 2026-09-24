# Terns and evaluation

**Tern** — one question → answer round, i.e. one run. A **thread** is a client's sequence of Terns.

## What a Tern stores

task · answer · status (`answered` | `guarded` | `failed` | `paused`) · stop reason · route · steps
(what each agent answered) · cost · `prompt_version` · `model_version` · `replay_of`.

- Every run writes a Tern — answered or failed.
- `prompt_version` / `model_version` = short sha256 of all agent and router prompts / of the resolved
  model settings. Same config → same versions; change a prompt → a new `prompt_version`.
- Storage: SQLite via built-in `node:sqlite` (no native dependency, Node ≥ 22.13), file
  `$TERN_DB` (default `~/.langgraph-agents/terns.sqlite`) — outside the repo. Schema migrations are
  versioned with `PRAGMA user_version`.
- Module `src/terns` depends on nothing else in `src` (ESLint).

## Scoring quality

```bash
npm run eval   -- [--version <prompt_version>] [--limit 100]
```

A judge (the default router model — Jev) answers for every unscored answered Tern: _is the answer
adequate to the task?_ Score = P(adequate). The command prints what was scored and a summary per
prompt version: Terns, scored, mean score, cost. A judge failure leaves a Tern unscored.

## Comparing a prompt change

```bash
npm run replay -- --version <old prompt_version> [--limit 100]
```

Re-runs the stored tasks of the old version with the **current** config as new threads
(`replay_of` set), scores both sides and prints `before → after` on the same tasks.

## Budget

Eval and replay pay from the account `<bundle>:eval` with **`budget.evalBudgetCap`** per UTC day —
production runs keep their `dailyBudgetCap`. Both stop cleanly when the eval budget is spent.

## Calibrate the judge first

Before trusting mean scores, label 20–30 Terns by hand and check the judge agrees with you.

# Terns and evaluation

**Tern** — one question → answer round, i.e. one run. A **thread** is a client's sequence of Terns.

## Threads and history

- `runAgent({ task })` without `threadId` = **first contact**: a new thread is created, its id comes
  back in the result (`threadId`). The client sends it with every next question.
- `runAgent({ task, threadId })` with an unknown id → `UnknownThreadError` before any call.
- The router and every agent see the last **`historyLimit`** Terns of the thread (question → answer),
  oldest first, before the task. Failed or guarded turns are shown with their status.
- CLI: `npm start -- --thread <id> "…"`; every run prints `thread: <id>`.

```
Previous turns:
Q: My name is Pavel
A: Nice to meet you, Pavel.

Task:
What is my name?
```

## Conversation memory (compaction)

Optional, per bundle (`compaction` in the config): every `every` turns (e.g. 5), right after the
answer, a model compacts them into one **self-contained** summary — full names, no pronouns pointing
outside it. It reads its own turns plus the **raw** turns of the previous window as context; a
summary never reads another summary, so nothing is re-compacted or blurred over time. Summaries are a
FIFO queue: readers see the latest `keep` (e.g. 10) plus the raw turns since the last compaction —
up to ~50 turns of memory at the price of ~10 notes. Older summaries leave the context but stay in
the database (`summaries` table).

Under the answer: `memory: turns 1–5 → summary 1/10`. A compaction error never fails the turn; the
next turn retries. Decision: [ADR-0007](ADR-0007-Conversation-memory-as-a-FIFO-queue-of-summaries).

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

## Comparing configurations

Every Tern also stores the declared config `version` and a config hash. To compare variants on the
same tasks (profiles, golden sets, pairwise judge), see [Profiles and comparisons](Profiles-and-comparisons).

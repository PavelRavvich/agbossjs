---
name: framework-review
description: Architecture review of the framework itself (DI, components, graph DSL, CLI) for extensibility and API quality in a world where code is written by agents, not by hand. Scores 17 axes, runs empirical probes (agent writes code, misconfiguration matrix, CLI contract, generators), verifies every finding, writes a report with an improvement proposal per finding and can file it as an epic. Use when the user asks for a framework / architecture / API / CLI review, "оцени архитектуру", "ревью фреймворка", or wants to compare against a previous review.
---

# framework-review

This is not a review of a diff. It asks two questions: **how cheap is it for an agent to make a correct
change, and how fast does it learn that a change is wrong?** Types are the agent's main feedback channel.
The CLI is its main tool for wiring. Docs and examples are its main source of patterns. Read every
axis with that in mind.

Checklist: `AXES.md` (17 axes, what to look at inside each). Probes: `PROBES.md`.

## Input

- Nothing → the whole framework (`packages/agboss`) + `examples/` + CLI.
- A list of axes (`1,2,17`) or a subsystem (`cli`, `agent-loop`, `dto`) → only those (a single
  axis costs roughly 1/5 of a full run).
- `--baseline <report or epic #>` → also diff against a previous review (fixed / new / unchanged).
- `--lang <en|ru>` → language of the report (default: the user's language; issues are always en).
- `--issue` → file the result as an epic (step 7).

## Hard rules

- **Never write inside the working repo.** Another session may be using the tree. Take a
  snapshot into a temp dir and run every probe there. Delete nothing in the repo and commit nothing.
- **Every finding needs a failure scenario**: "an agent does X → Y happens (compiles / fails at
  assembly / fails at runtime after N minutes / silently wrong)". If there is no scenario, it is
  taste. Drop it.
- **Every finding needs a proposal**: a concrete change (an API shape, a rule, a check, a test),
  with a short code sketch when the API changes. "Improve typing" is not a proposal.
- **No Spring/Angular/Nest as a yardstick.** "Not like Nest" is not a finding. When the API
  differs from a well-known framework, report only the _false friend_: it looks the same but behaves
  differently, so an agent confidently writes it the Nest way.
- **Evidence is `file:line`** or probe output. Prove claims about types with a compiled snippet,
  not by reading.
- **Facts over docs.** When the docs/CLAUDE.md and the code disagree, the code wins. The
  mismatch is itself a finding (axis 14).

## Steps

### 0. Snapshot and baseline

1. Find the **last commit that builds**. Walk `git log` from HEAD and build each commit
   (`git archive <c> | tar -x` into a temp dir, then the framework's `tsc -p`). Stop at the
   first green one. If HEAD or the working tree is red, that is finding #1 (axis 14). Review the
   green commit and say which one it is.
2. `node_modules`: on the same OS, symlink or copy them from the repo. In a Linux VM working
   on a macOS checkout, copy `node_modules` and add the Linux native binaries (`@rollup/rollup-linux-*`,
   `@esbuild/linux-*` via `npm pack`). Symlinks resolve back into the repo and load the macOS natives.
3. **Baseline numbers** for each package: `tsc` errors, lint errors, prettier failures, test
   pass/fail, build and typecheck time. Every sub-agent gets these numbers, so it can tell new
   errors from old ones.

### 1. Recon (main agent)

- Public surface: `package.json` `exports`, `bin`, and each entry's `index.ts`. Count exported
  symbols per entry and mark which ones are documented.
- Read README, CLAUDE.md / AGENTS.md, QUALITY.md, and the main example end to end.
- **Maturity stage** decides the axis weights:
  - _early_ (API still moving, one example): weight ×2 on axes 1, 2, 3, 14, 17; ×0.5 on 9, 15.
  - _stabilising_ (several examples, users outside the author): all ×1.
  - _mature_ (released, external plugins): ×2 on 7, 9, 13.
    State the stage and why in one line.
- Write a short **run context** file for the sub-agents: how to reach the snapshot, the
  baseline, the hard rules, the finding format.

### 2. Static pass and probes, in parallel

Start all of these in one message. Each sub-agent gets the run context, its axes from
`AXES.md` / its probes from `PROBES.md`, and **its own copy** of the snapshot for anything it writes.

| Agent                 | Scope                                                                              |
| --------------------- | ---------------------------------------------------------------------------------- |
| A — types & API       | axes 1, 2, 3, 8 + P0                                                               |
| B — agent runtime     | axes 4, 9, 10, 11, 12                                                              |
| C — quality & ops     | axes 5, 6, 7, 13, 14, 15, 16 + P7                                                  |
| D — CLI               | axis 17 + P4, P5                                                                   |
| P1 — fresh developer  | the P1 task only; does **not** get this skill, the axes or the run context's rules |
| P2 — misconfiguration | P2 matrix + P3 (self-judged, `confidence: medium`)                                 |

Each returns findings, a 0–5 score per owned axis with a one-line justification, and up to 3
concrete "what is good" bullets. Of all the probes, P1 gives the most signal for its cost. Never skip it.

### 3. Merge and de-duplicate

Agents overlap, and the same root cause gets reported 2–3 times. Merge the duplicates. Keep the
strongest evidence and the highest severity, and note "found independently by N agents", which
raises confidence. Where agents disagree on an axis score, take the probe-backed one.

### 4. Verify

A fresh sub-agent gets the merged list of claims (blockers and majors at least) and its own
snapshot copy. For each claim it either reproduces it (snippet, command, `file:line` re-read)
or rejects it with a reason. It also looks for the reason the claim could be wrong. Drop rejected
claims. Rewrite the ones it sharpens.

### 5. Group by root cause

Blockers are grouped by **root cause**, not listed one by one: for example "extension points that
pass tsc and tests but are dead", or "silent DI holes". Each group gets a table of its instances
and one combined proposal. Aim for 3–6 groups.

### 6. Report

Write `framework-review-<YYYY-MM-DD>.md` outside the repo and show it to the user. It goes into
the repo or tracker only when the user says so.

```markdown
# Framework review — <date> — <commit> (<why this commit>)

Stage: <early|stabilising|mature> — <why> · Weighted score: <x.x>/5
Method: <agents, probes, verification result N confirmed / M partly / K rejected>

## Scorecard

| # | Axis | Score 0–5 | Weight | Top issue |

## Blockers (grouped by root cause; each with instances table + proposals)

## Findings by axis (major, then minor; each with a proposal)

## Probe results (table: probe, result, numbers)

## What is good (keep it — max 7 bullets, concrete)

## Suggested order

## Baseline diff (only with --baseline)
```

Finding format:

```markdown
### F<n> [<blocker|major|minor|nit>] axis <#> — <one-line claim>

- Evidence: `path:line` / probe P<n> output
- Scenario: agent does … → …
- Proposal: <concrete change; code sketch if the API changes>
- Confidence: high|medium|low · Verified: probe|compile|read
```

Severity:

- **blocker**: a wrong change compiles and then fails silently or late at runtime, or a common
  extension is impossible without editing the core.
- **major**: a wrong change is caught only at runtime or assembly, or the correct path is
  non-obvious enough that the fresh agent in P1 missed it.
- **minor**: friction, such as extra files to touch, poor error text, or inconsistency.
- **nit**: naming or polish. At most 5 nits in the report.

Score anchors (per axis):

- 5 = a fresh agent cannot get it wrong without the compiler saying so.
- 3 = it works, but relies on docs or conventions.
- 1 = mostly runtime checks or tribal knowledge.
- 0 = absent.

Weighted score = Σ(score × weight) / Σ weight.

### 7. File as an epic (on `--issue` or when the user asks)

Follow the repo's tracker conventions (`triage` skill: labels, statuses, sub-issues). Always in
English.

- One issue labelled `type:epic`, titled `Framework review <date>: <one-line verdict>`. The
  body holds the full report, plus an `## Acceptance criteria` section in business terms (for example
  "a fresh agent adds an agent + tool following CLAUDE.md with zero doc-vs-code surprises").
- Sub-issues (one per blocker group, plus one per axis cluster of majors) only when the user asks
  for the split. Otherwise offer it.
- Status `Triage` (`scripts/ticket.sh status <N> Triage`, the `status:*` label). If an API this session cannot reach is needed, say so and give the
  command to run.

## Output to the user

The scorecard, the blocker groups (one line each), the link or path to the report/epic. Nothing else.

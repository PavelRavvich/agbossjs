---
name: triage
description: Conveyor stage 1 → status Triage. Takes a requirement (or an existing issue), clarifies its business side through quizzes — why, what it does, what it does NOT do, constraints, business acceptance criteria (AC1…) — and creates or updates GitHub issues, splitting into a parent with sub-issues when useful. Use whenever the user brings a new requirement, idea, request, bug report or an issue number/URL and wants it clarified, triaged, "заведи тикет", "разбери задачу" — before any technical spec or code.
---

# triage

Conveyor: **Triage** → Backlog → In progress → Test → Done.
This stage: the **business** side only. No architecture, no code, no implementation plan.
Output: issue(s) whose body answers why / what / what not / constraints / acceptance criteria (AC1…), in status
**Triage**.

Questions follow `.claude/skills/QUIZ.md` — read it before the first question.

## Input

- A requirement in free text → new issue(s).
- An issue number or URL → update mode: `gh issue view <N> --comments`, keep what is settled,
  ask only about gaps and contradictions.
- Several at once is fine; each gets its own quiz headers.

## Steps

1. **Context.** `scripts/wiki.sh pull`, read the relevant Wiki pages and skim the code the
   requirement touches. Existing answers become facts inside quiz situations, not questions.
2. **Quiz rounds** until every item has an answer or a recorded assumption:
   - **Why** — which problem, who has it, what it is worth, what happens if we do nothing.
   - **What it does** — the main scenarios as concrete examples (who does what, what they get).
   - **What it does NOT do** — explicit exclusions; nearby things people will assume are included.
   - **Constraints** — deadline, cost / budget, providers, data, compliance, compatibility.
   - **Acceptance criteria** — numbered `AC1`, `AC2`, …: each an observable outcome in business
     terms (who does what, what they see or get), testable, with no implementation terms.
     Together they define "done"; the spec later proves each one with a test or a manual check.
3. **Shape.** One issue, or a parent issue with sub-issues when parts deliver value on their own,
   touch different areas, or together exceed about a day of work. Propose the tree as a quiz
   (split / keep whole / other split, each with its price).
4. **Write.** Body via stdin (template below):
   - new: `gh issue create --title "<outcome, imperative>" --label "type:<feature|bugfix|chore|epic>,prio:<mvp|stretch>" --body-file -`
   - update: `gh issue edit <N> --body-file -`
   - hierarchy: `scripts/ticket.sh sub <parent> <child>`; the parent gets `type:epic`.
5. **Status.** `scripts/ticket.sh status <N> Triage` for every created or updated issue.
   Unresolved open question that blocks the spec → add label `blocked` and say why in a comment.
6. **Report** to the user: issues with links, the tree, assumptions, and the next step:
   `spec-session` for these issues.

## Issue body — triage part

```markdown
## Why

<problem, who has it, value>

## What it does

- <scenario as a concrete example>

## What it does NOT do

- <explicit exclusion>

## Constraints

- <deadline / cost / provider / data / compliance>

## Acceptance criteria

Business terms only — what a person does and what they see. Each is testable; together they
define "done".

- **AC1** — <who> <does what> → <what they see / get>
- **AC2** — …

## Assumptions

- <decided without an answer — flag for review>

## Triage log

- <question> → **<choice>** — <why; the price accepted>
```

Specs, plans and docs never go to repo files: issues hold the what and why, the Wiki holds how
the system works now.

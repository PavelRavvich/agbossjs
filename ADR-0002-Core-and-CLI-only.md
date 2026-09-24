# ADR-0002 — Template ships only the Agent Core + CLI

- **Status:** Accepted
- **Issue:** #12 (triage of triggers: #5–#11, closed as not planned)

## Context

Triage for running agents from outside the CLI produced a service: HTTP server, async runs with a
run store and callbacks, chat memory, in-process scheduler, concurrency limits, SSE, Docker. Each
of these depends on how a concrete project is deployed and called; in a template they are weight
that every derived project inherits and has to remove or adapt.

## Decision

The template contains the **Agent Core** (config, graph, routers, agents, FinOps, typing, tests)
and one entry point — the **CLI** (`npm start -- "task"`). The public API for any other entry
point is `runAgent(input, deps)` with `createAppDeps()`.

Webhooks, chat, schedules, run storage and deployment are built **in the project** created from
the template, as thin adapters over `runAgent`.

## Consequences

- The template stays small and has no infrastructure opinions.
- A scheduled run needs no code: any external cron can call the CLI.
- Every project writes its own adapter; the daily cap, run budget and cost report come with
  `runAgent` for free, so adapters stay thin.

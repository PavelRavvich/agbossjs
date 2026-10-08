# ADR-0014 — The workflow file is the graph (transitions), the hub router removed

- **Status:** Accepted (supersedes the hub graph of [Architecture](Architecture) before #116)
- **Issue:** #116 (branches: engine #137, job-scout #139; spikes #113, #114, #115)

## Context

Until #116 every workflow ran one fixed graph: `input guards → router ⇄ agent → finalize → output
guards`, with `routers: { main: { maxHops } }` and `budget` in `@Workflow`. Other shapes (a review
cycle, several entries, two routers) could not be expressed, the graph was not visible in the code, and
runaway loops ended quietly ("max hops reached", "budget exhausted") with a best-effort replyWith.

## Decision

- **The workflow file is the graph**: `@Workflow({ flow })` lists transitions between classes —
  `from(A).to(B)`, `from(Router).choose(X, Y)`, `chain(A, B, C)`, `node(Class, "name")`, `Self`. Nodes
  are `@Entry`, `@Router`, `@Agent`, `@Conclusion` classes; the agents are the flow's agent nodes.
- **Checked at assembly, all at once**: 15 rules (`graph.*`, `router.*`) before any model call; every
  violation is reported in one `GraphRuleError` naming the classes. Relations "by class" are a startup
  check, never compile time (component classes are empty to the compiler).
- **Run as a real LangGraph graph**: one node per flow node (`<kind>.<name>`), conditional edges for
  `choose`, entries from `START`, conclusions to `END`. An agent node runs its loop as a compiled
  subgraph, so the approval `interrupt()` pauses the whole run and nothing before it repeats.
- **Routers are nodes with routes**: `@Router({ prompt, model, maxVisits?, routes })` — the prompt says
  how to choose, each route what the choice means; texts normalised, routes sent sorted by name. No
  built-in `finish`: returning to the user is a route to a conclusion. A failed decision fails the run.
- **Limits fail, never stop quietly**: `settings().limits({ perRun: { steps, cost }, perDay: { cost } })`
  and `maxVisits`; steps count agent and router visits; `LimitExceededError` carries the key, path and
  spend, and the run is a failed Tern.
- **Removed**: the hub builder (`graph.ts`, `routing.ts`, the hub router node), `routers` and `budget`
  in `@Workflow`, `AgentsConfig` and profiles; `@Workflow({ agents })`.
- The existing guard, approval, compaction, knowledge and agent nodes run inside the new graph until
  #119 / #120 replace them; #100 (after a human decision the turn ends) is kept by the router node.

## Consequences

- A workflow's shape is code review-able and testable; `describe` lists it as transitions (a drawing
  comes with #127).
- Hitting a limit or a router failure (e.g. a Jev timeout) now **fails** the turn instead of answering
  with what is there — visible in the Tern and the CLI, at the price of an error message where the hub
  answered.
- Route texts matter: Jev picks by them, so "send the replyWith" must say when (see [Routers](Routers)).
- Eval keeps its own account (`<workflow>:eval`), now capped by `limits.perDay.cost`.
- Profiles cannot change the flow, routers or limits (they are code, versioned with the workflow).

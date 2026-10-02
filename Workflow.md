# Workflow — the graph as transitions

The workflow file **is** the graph: transitions between node classes, checked when the workflow is assembled (before any model call) and run as a LangGraph `StateGraph`.

```ts
import { chain, from, node, Self, WorkflowSettings, type WorkflowDefinition } from "graphcompose/graph";
import { usd } from "graphcompose/units";

flow: [
  from(ChatWorkflowStart).to(MainRouter),
  from(MainRouter).choose(ExplainerAgent, CoderAgent),
  from(ExplainerAgent).to(AnswerWorkflowFinish),
  chain(CoderAgent, ReviewerAgent, ReviewGateRouter),
  from(ReviewGateRouter).choose(CoderAgent, PullRequestWorkflowFinish),
],
```

## Flow DSL

| Form | Means |
| --- | --- |
| `from(A).to(B)` | unconditional step |
| `from(A, B).to(C)` | fan-in: one step from each source |
| `chain(A, B, C)` | `from(A).to(B)` + `from(B).to(C)` |
| `from(Router).choose(X, Y, …)` | the router picks one target |
| `Self` | in `choose` / `route`: the agent the router was called after |
| `const StyleReview = node(ReviewerAgent, "style-review")` | a second place for a class, under its own name — declare it **once**, as a constant |

Nodes are classes decorated `@WorkflowStart`, `@Router`, `@Agent`, `@WorkflowFinish` (`@WorkflowPause` comes with #117 — start, pause and finish of a run read as one trio). Agents and routers are **working nodes**: each visit is a step. The workflow's agents are its flow's agent nodes — `@Workflow` has no `agents` list; a named node (`node(ReviewerAgent, "style-review")`) is its own agent under that name.

## Workflow starts and finishes (minimal — #117 extends them)

```ts
// workflow-starts/chat.workflow-start.ts
import { WorkflowStartText } from "graphcompose/dto";
import { WorkflowStart } from "graphcompose/graph";

@WorkflowStart({ name: "chat", description: "A message from the job seeker", input: WorkflowStartText })
export class ChatWorkflowStart {}

// workflow-finishes/chat.workflow-finish.ts
import { WorkflowFinishText } from "graphcompose/dto";
import { WorkflowFinish } from "graphcompose/graph";

@WorkflowFinish({ name: "chat", description: "The answer sent back to the job seeker", output: WorkflowFinishText })
export class ChatWorkflowFinish {}
```

- **Class names:** the run's general purpose names both — `ChatWorkflowStart` / `ChatWorkflowFinish`,
  `DailyDigestWorkflowStart` / `DailyDigestWorkflowFinish`; different qualifiers only for several
  outcomes of one purpose (`AnswerWorkflowFinish`, `PullRequestWorkflowFinish`). A class is never just
  `WorkflowStart` (that is the decorator, and a workflow may have several starts). `gc create` makes
  `TextWorkflowStart` / `TextWorkflowFinish` (both named `text`).
- **A start and a finish may share a name** (`chat` / `chat`): starts are never a step's target, so
  they have names of their own; any other two nodes with one name are `graph.duplicate-node`.
- **Run at a workflow start:** `app.run(ChatWorkflowStart, { text: "find jobs" }, { thread })`
  ([App](App)) — the start must be one of this workflow's, the input is checked against its DTO, its
  `text` is the task. The CLI (`gc chat`, `gc run`) goes to the workflow's text start
  (`app.textStart`: input `WorkflowStartText`, else the first start); `runAgent({ task, threadId?, start? })`
  is the lower-level entry point.
- **Workflow finish:** the answer is the last agent's text. The result names the finish reached
  (`result.finish`, absent when a guard stopped the run or it is paused).

## The existing nodes in the flow (until #119 / #120 replace them)

| Flow node | Runs |
| --- | --- |
| workflow start | the **input guards** — a trip ends the run before any working node spends money |
| agent | the agent's **own loop as a compiled subgraph** ([Agents](Agents)): knowledge (context mode), model turns, the move boundary, the **approval pause** (one call per pause) and tool calls stored by `callId` — the pause interrupts the whole run; nothing finished before it is repeated on resume |
| router | its own model decides among its routes; after a human decision in this turn and the agent's answer, it sends the turn to its workflow finish **without a call** (#100) |
| workflow finish | the last answer, then the **output guards** (a trip replaces it with the guard's refusal) |

Compaction runs after a finished turn, as before. Every outcome is a Tern: answered, guarded, paused,
or **failed** — a limit (`LimitExceededError`) or a router that could not decide (`RouterDecisionError`)
fails the run with its path and spend.

## Example: job-scout (2.0.0)

```ts
@Workflow({
  name: "job-scout",
  version: "2.0.0",
  flow: [
    from(ChatWorkflowStart).to(MainRouter),
    from(MainRouter).choose(Profiler, Scout, Shortlist, ChatWorkflowFinish),
    from(Profiler, Scout, Shortlist).to(MainRouter),
  ],
  defaults, guards, compaction, mcp: [ShortlistServer], providers: [ … ],
  needsApproval: writeToolsNeedApproval,
})
export class JobScout implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder()
      .limits({ perRun: { steps: 12, cost: usd(0.1) }, perDay: { cost: usd(1) } })
      .build();
  }
}
```

`gc describe` lists the flow as transitions (drawing comes with #127):

```
limits    run 12 steps · $0.1 · day $1
flow
  chat (workflow start) → main
  main → profiler | scout | shortlist | chat (workflow finish)
  profiler, scout, shortlist → main
routers
  main  jev typesafe/jev-1.13 · maxVisits 3 — Sends the job seeker's message to the right agent, or sends the answer
```

A broken flow fails `workflowOf` (so `describe`, `chat`, `run`, Studio) with every violation at once:

```
GraphRuleError: The workflow's flow breaks 3 rule(s):
  - [graph.unreachable-node] Shortlist cannot be reached from a workflow start
  - [graph.cycle-without-router] cycle without a router: Scout → Profiler
  - [router.routes-mismatch] router MainRouter: routes differ from choose(...) — routes not in its choose(...): Shortlist
```

## Assembly rules

Checked before any model call; **every** violation is reported at once in one `GraphRuleError` (`violations: { code, message, nodes }[]`, nodes named by class).

| Rule | Code |
| --- | --- |
| something in `flow` that is not a node (a tool, a channel…) | `graph.not-a-node` |
| a node has one unconditional next **or** one `choose` | `graph.two-next-steps` |
| `choose` only from a router | `graph.choose-from-non-router` |
| a router in a `chain` only as the last element | `graph.router-not-last-in-chain` |
| every cycle passes through a router | `graph.cycle-without-router` |
| two nodes with one name (one class = one node) | `graph.duplicate-node` |
| a `node(…, "name")` name declared twice | `graph.duplicate-node-name` |
| at least one workflow start | `graph.no-workflow-start` |
| every node reachable from a workflow start | `graph.unreachable-node` |
| every path reaches a workflow finish | `graph.dead-end` |
| a workflow finish has no next step | `graph.next-after-workflow-finish` |
| a router's `routes` equal its `choose(...)` (`Self` counted as itself) | `router.routes-mismatch` |
| `route(Self, …)` only when every predecessor of the router is an agent | `router.self-without-agent-before` |
| a router has `prompt` and / or `promptUrls` | `router.no-prompt` |
| every route has a text | `router.empty-route-text` |
| every router on a cycle (a `Self` route included) declares `maxVisits` — the violation names the router and one cycle through it: `MainRouter is on a cycle (MainRouter → Profiler → MainRouter) but has no maxVisits` | `router.unbounded-cycle` |

## How it runs

- One LangGraph node per flow node, named `<kind>.<name>` (e.g. `workflow-start.chat`, `router.main`, `workflow-finish.chat` — flow names may equal state keys, which LangGraph does not allow as node names).
- `to` → an edge; `choose` → a conditional edge on the router's decision; workflow starts from `START` (several starts: the run's `start` input picks one); workflow finishes to `END`.
- A node may run a **compiled subgraph** (`subgraphNode(graph, { input, output })`; each agent's loop is one): an `interrupt()` inside it pauses the whole run and `Command({ resume })` continues it.
- The state keeps the path, visits per node, steps, and the previous agent (for `Self`). Path and visits use node keys: a start is `workflow-start.<name>`, every other node its name (also in `LimitExceededError.path`).

## Settings and limits

```ts
@Workflow({ name, version, flow, … })
export class CodeReviewWorkflow implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder()
      .limits({ perRun: { steps: 30, cost: usd(0.5) }, perDay: { cost: usd(5) } })
      .build();
  }
}
```

| Limit | Boundary key | Default |
| --- | --- | --- |
| steps per run (agent and router visits; workflow starts and finishes do not count) | `limits.perRun.steps` | (agents + routers) × 3 |
| visits of one router per run | `routers.<name>.maxVisits` | none |
| spend per run | `limits.perRun.cost` | none |
| the workflow's spend per UTC day (the ledger's spend before the run + the run's own) | `limits.perDay.cost` | none |

Checked before each working node runs; the day's spend is also checked before the run starts (nothing left → no calls at all). Hitting a limit **fails** the run with `LimitExceededError` (`key`, `limit`, `actual`, `path`, `spentUsd`) — never a quiet stop. The last allowed visit passes; one more fails. LangGraph's `recursionLimit` is set far above, as a safety net only.

`graphcompose/units`: `usd(amount)`, `seconds(n)`, `minutes(n)` — checked once (finite, ≥ 0), branded by unit.

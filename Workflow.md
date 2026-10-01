# Workflow — the graph as transitions

> Status: the **graph engine** is merged (#116, branch A). Running real workflows on it (`@Entry`, `@Conclusion`, job-scout migrated, the hub-router builder removed) arrives with #116 branch B; until then `@Workflow({ agents, routers, budget })` and the hub graph (see [Architecture](Architecture)) still run.

The workflow file **is** the graph: transitions between node classes, checked when the workflow is assembled (before any model call) and run as a LangGraph `StateGraph`.

```ts
import { chain, from, node, Self, WorkflowSettings, type WorkflowDefinition } from "graphcompose/graph";
import { usd } from "graphcompose/units";

flow: [
  from(ChatEntry).to(MainRouter),
  from(MainRouter).choose(ExplainerAgent, CoderAgent),
  from(ExplainerAgent).to(AnswerConclusion),
  chain(CoderAgent, ReviewerAgent, ReviewGateRouter),
  from(ReviewGateRouter).choose(CoderAgent, PullRequestConclusion),
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

Nodes are classes decorated `@Entry`, `@Router`, `@Agent`, `@Conclusion`. Agents and routers are **working nodes**: each visit is a step.

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
| at least one entry | `graph.no-entry` |
| every node reachable from an entry | `graph.unreachable-node` |
| every path ends at a conclusion | `graph.dead-end` |
| a conclusion has no next step | `graph.next-after-conclusion` |
| a router's `routes` equal its `choose(...)` (`Self` counted as itself) | `router.routes-mismatch` |
| `route(Self, …)` only when every predecessor of the router is an agent | `router.self-without-agent-before` |
| a router has `prompt` and / or `promptUrls` | `router.no-prompt` |
| every route has a text | `router.empty-route-text` |

## How it runs

- One LangGraph node per flow node, named `<kind>.<name>` (e.g. `router.main`, `conclusion.answer` — flow names may equal state keys, which LangGraph does not allow as node names).
- `to` → an edge; `choose` → a conditional edge on the router's decision; entries from `START` (several entries: the run's `entry` input picks one); conclusions to `END`.
- A node may run a **compiled subgraph** (`subgraphNode(graph, { input, output })`): an `interrupt()` inside it pauses the whole run and `Command({ resume })` continues it.
- The state keeps the path, visits per node, steps, and the previous agent (for `Self`).

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
| steps per run (agent and router visits; entries and conclusions do not count) | `limits.perRun.steps` | (agents + routers) × 3 |
| visits of one router per run | `routers.<name>.maxVisits` | none |
| spend per run | `limits.perRun.cost` | none |
| the workflow's spend per UTC day (the ledger's spend before the run + the run's own) | `limits.perDay.cost` | none |

Checked before each working node runs. Hitting a limit **fails** the run with `LimitExceededError` (`key`, `limit`, `actual`, `path`, `spentUsd`) — never a quiet stop. The last allowed visit passes; one more fails. LangGraph's `recursionLimit` is set far above, as a safety net only.

`graphcompose/units`: `usd(amount)`, `seconds(n)`, `minutes(n)` — checked once (finite, ≥ 0), branded by unit.

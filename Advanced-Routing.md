# DSL Routing & Parallelism

A cheat sheet of the `flow:` block of `@Workflow`: routing, parallelism and barriers. Everything here
is in the root entry `graphcompose` (`from`, `chain`, `parallel`, `optional`, `catchError`, `node`,
`Self`, `@BatchParallelStrategy`, `@QuorumRouter`). The basics are on [Workflow](Workflow).

The nodes used below (agents, routers, starts and finishes — ordinary components):

<!--
```ts file=nodes.ts
import { Agent, BatchParallelStrategy, QuorumRouter, Router, WorkflowFinish, WorkflowStart, optional, parallel, type QuorumStrategy } from "graphcompose";
import { WorkflowFinishText, WorkflowStartText } from "graphcompose/dto";
const model = "moonshotai/kimi-k2.6";
@WorkflowStart({ name: "start", description: "The task", input: WorkflowStartText })
export class StartNode { declare readonly input: WorkflowStartText; }
@WorkflowFinish({ name: "finish", description: "The answer", output: WorkflowFinishText })
export class FinishNode {}
@WorkflowFinish({ name: "lockdown", description: "The release is stopped", output: WorkflowFinishText })
export class EmergencyLockdown {}
@Agent({ name: "agent-a", description: "A", prompt: "Do A.", model }) export class AgentA {}
@Agent({ name: "agent-b", description: "B", prompt: "Do B.", model }) export class AgentB {}
@Agent({ name: "agent-c", description: "C", prompt: "Do C.", model }) export class AgentC {}
@Agent({ name: "preparation", description: "Prepares", prompt: "Prepare.", model }) export class PreparationAgent {}
@Agent({ name: "aggregator", description: "Aggregates", prompt: "Aggregate.", model }) export class AggregatorAgent {}
@Agent({ name: "main-worker", description: "Does the work", prompt: "Work.", model }) export class MainWorker {}
@Agent({ name: "legal", description: "Legal review", prompt: "Review.", model }) export class LegalAgent {}
@Agent({ name: "finance", description: "Finance", prompt: "Finance.", model }) export class FinanceAgent {}
@Agent({ name: "hr", description: "HR", prompt: "HR.", model }) export class HrAgent {}
@Agent({ name: "tech", description: "Tech", prompt: "Tech.", model }) export class TechAgent {}
@Agent({ name: "success", description: "Valid input", prompt: "Proceed.", model }) export class SuccessAgent {}
@Agent({ name: "error", description: "Invalid input", prompt: "Explain.", model }) export class ErrorAgent {}
@Agent({ name: "finalizer", description: "Finalizes", prompt: "Finalize.", model }) export class Finalizer {}
@Agent({ name: "dispatcher", description: "Collects URLs", prompt: "Collect.", model }) export class DispatcherAgent {}
@Agent({ name: "scraper", description: "Scrapes {{item}}", prompt: "Scrape {{item}}.", model }) export class ScraperAgent {}
@Agent({ name: "summary", description: "Summarizes", prompt: "Summarize.", model }) export class SummaryAgent {}
@Agent({ name: "static", description: "Static analysis", prompt: "Analyze.", model }) export class StaticAnalyzer {}
@Agent({ name: "dynamic", description: "Dynamic analysis", prompt: "Analyze.", model }) export class DynamicAnalyzer {}
@Agent({ name: "deps", description: "Dependency check", prompt: "Check.", model }) export class DependencyChecker {}
@Router({ name: "validator", description: "Valid or not", prompt: "Is the input valid?", model: "typesafe/jev-1.13", routes: [{ prompt: "The input is valid", target: SuccessAgent }, { prompt: "The input is invalid", target: ErrorAgent }] })
export class ValidatorRouter {}
@Router({ name: "compliance", description: "Legal or not", prompt: "Does it need a legal review?", model: "typesafe/jev-1.13", routes: [{ prompt: "Needs a legal review, next to the main work", target: parallel(MainWorker, optional(LegalAgent)) }] })
export class ComplianceRouter {}
@Router({ name: "expertise", description: "Who reviews", prompt: "Who reviews it?", model: "typesafe/jev-1.13", routes: [{ prompt: "Money matters only", target: FinanceAgent }, { prompt: "Money and people", target: parallel(FinanceAgent, HrAgent) }, { prompt: "Money and tech", target: parallel(FinanceAgent, TechAgent) }] })
export class ExpertiseRouter {}
@BatchParallelStrategy()
export class UrlExtractorStrategy { extract(): string[] { return ["https://a.example", "https://b.example"]; } }
@QuorumRouter({ name: "security-quorum" })
export class SecurityQuorum implements QuorumStrategy { filterVote(): boolean { return true; } route(_state: unknown, hasQuorum: boolean) { return hasQuorum ? EmergencyLockdown : FinishNode; } }
```
-->

## 1. Sequential execution

<!-- snippet-context
import { chain, from, type Flow } from "graphcompose";
import { AgentA, AgentB, FinishNode, StartNode } from "./nodes.js";
export const flow: Flow = [
// @snippet
];
-->

```ts
from(StartNode).next(AgentA),
from(AgentA).next(AgentB),
from(AgentB).next(FinishNode),
// or, as one step: chain(StartNode, AgentA, AgentB, FinishNode)
```

`chain(...)` is a straight line of unconditional steps; a router may only be its last node.

## 2. Static parallelism (fork & join)

The graph splits into a known number of branches and waits for all of them:

<!-- snippet-context
import { from, type Flow } from "graphcompose";
import { AgentA, AgentB, AgentC, AggregatorAgent, FinishNode, PreparationAgent, StartNode } from "./nodes.js";
export const flow: Flow = [
// @snippet
];
-->

```ts
from(StartNode).next(PreparationAgent),
from(PreparationAgent).nextParallel(AgentA, AgentB, AgentC), // three branches
from(AgentA, AgentB, AgentC).join(AggregatorAgent), // the barrier: waits for all three
from(AggregatorAgent).next(FinishNode),
```

## 3. Dynamic parallelism (`batchParallel`, map-reduce)

When the number of items is known only at run time, a `@BatchParallelStrategy()` class extracts them
from the state; the target runs once per batch of `batchSize` items, at most `concurrencyLimit` at a
time. An agent sees its item as `{{item}}` in its prompt, an action as `ctx.item`.

<!-- snippet-context
import { from, type Flow } from "graphcompose";
import { DispatcherAgent, FinishNode, ScraperAgent, StartNode, SummaryAgent, UrlExtractorStrategy } from "./nodes.js";
export const flow: Flow = [
// @snippet
];
-->

```ts
from(StartNode).next(DispatcherAgent),
// 10,000 URLs in batches of 100, at most 10 ScraperAgent runs at once
from(DispatcherAgent).batchParallel(ScraperAgent, UrlExtractorStrategy, {
  batchSize: 100,
  concurrencyLimit: 10,
}),
from(ScraperAgent).next(SummaryAgent),
from(SummaryAgent).next(FinishNode),
```

A strategy is a decorated class with `extract(state)`:

<!-- snippet-context
import { BatchParallelStrategy } from "graphcompose";
interface CrawlState { readonly urls: readonly string[] }
-->

```ts
@BatchParallelStrategy()
export class UrlExtractor {
  extract(state: CrawlState): string[] {
    return [...state.urls];
  }
}
```

A batch that pauses (an approval) resumes with the items already done kept; `batchSize` and
`concurrencyLimit` must be positive (`batch.invalid-batch-size`, `batch.invalid-concurrency-limit`),
the strategy decorated (`batch.strategy-not-decorated`).

## 4. Routing: one choice

A router picks **one** of its `routes`; `from(Router).routes()` takes them from the router, so the
list exists once:

<!-- snippet-context
import { from, type Flow } from "graphcompose";
import { ErrorAgent, Finalizer, FinishNode, StartNode, SuccessAgent, ValidatorRouter } from "./nodes.js";
export const flow: Flow = [
// @snippet
];
-->

```ts
from(StartNode).next(ValidatorRouter),
from(ValidatorRouter).routes(), // SuccessAgent or ErrorAgent
from(SuccessAgent, ErrorAgent).next(Finalizer),
from(Finalizer).next(FinishNode),
```

## 5. Routing: an optional branch

A route's target may be `parallel(...)` — several branches at once — and `optional(...)` marks a
branch whose failure is reported and skipped instead of failing the run:

<!-- snippet-context
import { Router, optional, parallel } from "graphcompose";
import { LegalAgent, MainWorker } from "./nodes.js";
-->

```ts
@Router({
  name: "compliance",
  description: "Adds a legal review when the work needs one",
  prompt: "Does the work need a legal review?",
  model: "typesafe/jev-1.13",
  routes: [
    { prompt: "Needs a legal review", target: parallel(MainWorker, optional(LegalAgent)) },
    { prompt: "No legal review", target: MainWorker },
  ],
})
export class LegalCheckRouter {}
```

<!-- snippet-context
import { from, type Flow } from "graphcompose";
import { ComplianceRouter, Finalizer, FinishNode, LegalAgent, MainWorker, StartNode } from "./nodes.js";
export const flow: Flow = [
// @snippet
];
-->

```ts
from(StartNode).next(ComplianceRouter),
from(ComplianceRouter).routes(),
from(MainWorker, LegalAgent).join(Finalizer), // waits only for the branches the router started
from(Finalizer).next(FinishNode),
```

## 6. Routing: several branches

Each route is one choice; a choice of several branches is a route to `parallel(...)`:

<!-- snippet-context
import { Router, parallel } from "graphcompose";
import { FinanceAgent, HrAgent, TechAgent } from "./nodes.js";
-->

```ts
@Router({
  name: "expertise",
  description: "Picks the reviewers",
  prompt: "Who must review the request? Finance always does.",
  model: "typesafe/jev-1.13",
  routes: [
    { prompt: "Money matters only", target: FinanceAgent },
    { prompt: "Money and people", target: parallel(FinanceAgent, HrAgent) },
    { prompt: "Money and tech", target: parallel(FinanceAgent, TechAgent) },
  ],
})
export class ReviewersRouter {}
```

`Self` as a target sends the work back to the agent that ran last (the router then needs
`maxVisits`). Routes are sent sorted by target name, so their order never changes the request.

## 7. Errors (`catchError`)

<!-- snippet-context
import { catchError, chain, from, type Flow } from "graphcompose";
import { AgentA, ErrorAgent, FinishNode, StartNode } from "./nodes.js";
class NetworkError extends Error {
  static readonly code = "app.network";
}
export const flow: Flow = [
// @snippet
];
-->

```ts
chain(StartNode, AgentA, FinishNode),
catchError(AgentA, NetworkError).next(ErrorAgent), // instead of failing the run
from(ErrorAgent).next(FinishNode),
```

`catchError(Node, ErrorClass)` matches by the class's stable `code` (a class without a `static code`
by its name): the class, its subclasses and errors caused by it. The default `Error` catches
everything. The match is made on a plain record in the state, so it holds after a resume.

## 8. Custom barriers (QuorumRouter)

`joinQuorum` is an active barrier for parallel branches: unlike `join`, which waits for all of
them, it counts votes as branches finish, and can stop early, fail fast or time out. A
`@QuorumRouter` class implements `QuorumStrategy`: `filterVote(state)` runs as each branch finishes
(is this a vote?), `route(state, hasQuorum)` once at the end (where to go).

<!-- snippet-context
import { QuorumRouter, type QuorumStrategy } from "graphcompose";
import { EmergencyLockdown, FinishNode } from "./nodes.js";
interface AuditState { readonly reports: readonly { readonly severity: string }[] }
-->

```ts
@QuorumRouter({ name: "critical-findings" })
export class CriticalFindings implements QuorumStrategy<AuditState> {
  filterVote(state: AuditState): boolean {
    return state.reports.at(-1)?.severity === "CRITICAL";
  }

  route(_state: AuditState, hasQuorum: boolean) {
    return hasQuorum ? EmergencyLockdown : FinishNode;
  }
}
```

<!-- snippet-context
import { from, type Flow } from "graphcompose";
import { DependencyChecker, DynamicAnalyzer, EmergencyLockdown, FinishNode, SecurityQuorum, StartNode, StaticAnalyzer } from "./nodes.js";
export const flow: Flow = [
// @snippet
];
-->

```ts
from(StartNode).nextParallel(StaticAnalyzer, DynamicAnalyzer, DependencyChecker),
from(StaticAnalyzer, DynamicAnalyzer, DependencyChecker)
  .joinQuorum(SecurityQuorum, {
    min: 2, // at least 2 critical reports
    max: 3, // with 3, stop at once
    timeoutSeconds: 45, // do not wait longer for the slow branches
  })
  .routes(EmergencyLockdown, FinishNode),
```

How `min`, `max` and `timeoutSeconds` combine:

1. **Only `{ min }`** (`max` = `min`): as soon as `min` votes are in, the other branches are
   cancelled and `route` gets `hasQuorum = true`; once `min` cannot be reached any more (too many
   branches finished without a vote), they are cancelled and `hasQuorum = false`.
2. **`{ min, max }`**: reaching `min` does not cancel the others — the barrier waits for `max`. At
   `max` the rest are cancelled (`true`); when all finish, `hasQuorum` is `votes >= min`.
3. **`{ min, max, timeoutSeconds }`**: as 2, and after the timeout the remaining branches are
   cancelled and `hasQuorum` is `votes >= min`. Too many early non-votes fail fast without waiting.
4. **`{ min, timeoutSeconds }`** (`max` = `min`): `min` votes end it at once (`true`); the timeout
   ends it with `false`.

## 9. Nested workflows

A `@Workflow` class is a node of another flow — `from(StartAgent).next(SubWorkflow)` — and runs as a
subgraph from its start to its finish, sharing the parent's limits and spend. See
[Workflow → Nested workflows](Workflow#nested-workflows).

## 10. Saga orchestration

An `@Agent({ compensate: UndoWorkflowOrAction })` declares how to undo it; a
`catchError(Node).compensateWith(Compensator)` step runs the compensation when a later step fails.
See [Saga and cancellation](Saga-And-Cancellation).

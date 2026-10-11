# Workflows & DSL

A workflow is a `@Workflow` class whose `flow` lists the transitions between its nodes: a
**workflow start**, **routers**, **agents**, **actions** and **workflow finishes**. The flow DSL
(`from(...)`, `chain(...)`, `catchError(...)`, all from `agboss`) is checked when the workflow
is assembled — before any model call — and every violation is reported at once. Every block on this
page compiles against the current package (`npm run check:docs`).

## Writing a workflow

<!-- snippet-context
import { Agent } from "agboss";
import { WorkflowFinishText, WorkflowStartText } from "agboss/dto";
@Agent({ name: "planner", description: "Plans the work", prompt: "Plan the task.", model: "moonshotai/kimi-k2.6" })
export class PlannerAgent {}
@Agent({ name: "writer", description: "Writes the answer", prompt: "Write the answer.", model: "moonshotai/kimi-k2.6" })
export class WriterAgent {}
export { WorkflowFinishText, WorkflowStartText };
-->

```ts
import {
  Workflow,
  WorkflowFinish,
  WorkflowSettings,
  WorkflowStart,
  from,
  type WorkflowDefinition,
} from "agboss";
import { usd } from "agboss/units";

@WorkflowStart({ name: "task", description: "The task to do", input: WorkflowStartText })
export class TaskStart {
  declare readonly input: WorkflowStartText; // types app.execute(TaskStart, input)
}

@WorkflowFinish({ name: "answer", description: "The answer", output: WorkflowFinishText })
export class AnswerFinish {}

@Workflow({
  name: "planner",
  version: "1.0.0",
  flow: [
    from(TaskStart).next(PlannerAgent),
    from(PlannerAgent).next(WriterAgent),
    from(WriterAgent).next(AnswerFinish),
  ],
  defaults: {
    models: { temperature: 0 },
    router: { kind: "jev", model: "typesafe/jev-1.13" },
    history: { limit: 5 },
  },
})
export class PlannerWorkflow implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder().limits({ perRun: { steps: 6, cost: usd(0.05) } }).build();
  }
}
```

The examples below show only the `flow` array; the classes are components like the ones above.

<!--
```ts file=flow-nodes.ts
import { BatchParallelStrategy, QuorumRouter, Router, type QuorumStrategy } from "agboss";
export declare class TaskStart {}
export declare class AnswerFinish {}
export declare class PlannerAgent {}
export declare class WriterAgent {}
export declare class CoderAgent {}
export declare class TechLeadAgent {}
export declare class FinanceAgent {}
export declare class HrAgent {}
export declare class TechAgent {}
export declare class AggregatorAgent {}
export declare class AnalyticsAgent {}
export declare class ResearchAgent {}
export declare class FallbackAgent {}
@Router({ name: "main", description: "Picks the next agent", prompt: "Pick who works next.", model: "typesafe/jev-1.13", maxVisits: 3, routes: [{ prompt: "Code changes", target: CoderAgent }, { prompt: "Design questions", target: TechLeadAgent }, { prompt: "Stop and send the answer: the work is done", target: AnswerFinish }] })
export class MainRouter {}
@BatchParallelStrategy()
export class TopicsOfPlan { extract(): string[] { return ["pricing", "competitors"]; } }
@QuorumRouter({ name: "consensus" })
export class Consensus implements QuorumStrategy { filterVote(): boolean { return true; } route() { return AnswerFinish; } }
```
-->

### 1. Linear transitions

<!-- snippet-context
import { catchError, chain, from, node, LimitExceededError, type Flow } from "agboss";
import { TaskStart, AnswerFinish, PlannerAgent, WriterAgent, CoderAgent, TechLeadAgent, FinanceAgent, HrAgent, TechAgent, AggregatorAgent, AnalyticsAgent, ResearchAgent, FallbackAgent, MainRouter, TopicsOfPlan, Consensus } from "./flow-nodes.js";
export const flows: Flow[] = [
// @snippet
];
-->

```ts
[
  from(TaskStart).next(PlannerAgent), // unconditional
  from(PlannerAgent).next(WriterAgent),
  from(WriterAgent).next(AnswerFinish),
],
// the same, as one step: a straight line (a router may only be last)
[chain(TaskStart, PlannerAgent, WriterAgent, AnswerFinish)],
```

### 2. Routers

A `@Router` decides where to go next by a model (Jev or a chat model). Its targets are its own
`routes` — `from(Router).routes()` reads them, so the list exists once ([Routers](Routers)):

<!-- snippet-context
import { catchError, chain, from, node, LimitExceededError, type Flow } from "agboss";
import { TaskStart, AnswerFinish, PlannerAgent, WriterAgent, CoderAgent, TechLeadAgent, FinanceAgent, HrAgent, TechAgent, AggregatorAgent, AnalyticsAgent, ResearchAgent, FallbackAgent, MainRouter, TopicsOfPlan, Consensus } from "./flow-nodes.js";
export const flows: Flow[] = [
// @snippet
];
-->

```ts
[
  from(TaskStart).next(MainRouter),
  from(MainRouter).routes(), // CoderAgent, TechLeadAgent or AnswerFinish
  from(CoderAgent, TechLeadAgent).next(MainRouter), // fan-in: both go back to the router
],
```

A route's target may also be `parallel(A, B)` (both run) or `optional(A)` (a branch whose failure
is reported and skipped); a `join` waits only for the branches the router started — see [Advanced Routing](Advanced-Routing).

### 3. Static parallelism and joins

<!-- snippet-context
import { catchError, chain, from, node, LimitExceededError, type Flow } from "agboss";
import { TaskStart, AnswerFinish, PlannerAgent, WriterAgent, CoderAgent, TechLeadAgent, FinanceAgent, HrAgent, TechAgent, AggregatorAgent, AnalyticsAgent, ResearchAgent, FallbackAgent, MainRouter, TopicsOfPlan, Consensus } from "./flow-nodes.js";
export const flows: Flow[] = [
// @snippet
];
-->

```ts
[
  from(TaskStart).next(PlannerAgent),
  from(PlannerAgent).nextParallel(FinanceAgent, HrAgent, TechAgent), // fan-out: all three run
  from(FinanceAgent, HrAgent, TechAgent).join(AggregatorAgent), // waits for all three
  from(AggregatorAgent).next(AnswerFinish),
],
```

### 4. Dynamic parallelism (`batchParallel`)

When the number of items is known only at run time, a `@BatchParallelStrategy()` class extracts
them from the state and the target runs once per batch of items:

<!-- snippet-context
import { catchError, chain, from, node, LimitExceededError, type Flow } from "agboss";
import { TaskStart, AnswerFinish, PlannerAgent, WriterAgent, CoderAgent, TechLeadAgent, FinanceAgent, HrAgent, TechAgent, AggregatorAgent, AnalyticsAgent, ResearchAgent, FallbackAgent, MainRouter, TopicsOfPlan, Consensus } from "./flow-nodes.js";
export const flows: Flow[] = [
// @snippet
];
-->

```ts
[
  from(TaskStart).next(PlannerAgent),
  from(PlannerAgent).batchParallel(ResearchAgent, TopicsOfPlan, { concurrencyLimit: 2, batchSize: 1 }),
  from(ResearchAgent).next(WriterAgent),
  from(WriterAgent).next(AnswerFinish),
],
```

An agent sees its item as `{{item}}` in its prompt, an action as `ctx.item` (its batch when
`batchSize` > 1).

### 5. Quorum joins

`joinQuorum(Strategy, { min, max?, timeoutSeconds? })` lets the run go on once enough branches have
voted; the `@QuorumRouter` class decides where ([Advanced Routing](Advanced-Routing#8-custom-barriers-quorumrouter)):

<!-- snippet-context
import { catchError, chain, from, node, LimitExceededError, type Flow } from "agboss";
import { TaskStart, AnswerFinish, PlannerAgent, WriterAgent, CoderAgent, TechLeadAgent, FinanceAgent, HrAgent, TechAgent, AggregatorAgent, AnalyticsAgent, ResearchAgent, FallbackAgent, MainRouter, TopicsOfPlan, Consensus } from "./flow-nodes.js";
export const flows: Flow[] = [
// @snippet
];
-->

```ts
[
  from(TaskStart).nextParallel(FinanceAgent, HrAgent, TechAgent),
  from(FinanceAgent, HrAgent, TechAgent).joinQuorum(Consensus, { min: 2 }).routes(AnswerFinish),
],
```

### 6. Errors and second places

<!-- snippet-context
import { catchError, chain, from, node, LimitExceededError, type Flow } from "agboss";
import { TaskStart, AnswerFinish, PlannerAgent, WriterAgent, CoderAgent, TechLeadAgent, FinanceAgent, HrAgent, TechAgent, AggregatorAgent, AnalyticsAgent, ResearchAgent, FallbackAgent, MainRouter, TopicsOfPlan, Consensus } from "./flow-nodes.js";
export const flows: Flow[] = [
// @snippet
];
-->

```ts
[
  chain(TaskStart, WriterAgent, AnswerFinish),
  catchError(WriterAgent, LimitExceededError).next(FallbackAgent), // a failure goes on, by code
  from(FallbackAgent).next(AnswerFinish),
],
[chain(TaskStart, WriterAgent, node(WriterAgent, "second-draft"), AnswerFinish)],
```

- `catchError(Node, ErrorClass)` matches by the error's stable `code` — the class's, its
  subclasses', and anything it caused — so it holds after a resume. `compensateWith(...)` is the
  same step for a compensating target ([Saga and cancellation](Saga-And-Cancellation)).
- `node(Class, "name")` is a second place for the same class; declare it once as a constant.

## Assembly rules

Checked by `workflowOf` / `createApp` before any model call; all violations are reported together
in a `GraphRuleError` with stable codes (`graph.*`, `router.*`, `batch.*`): every node is a
decorated class, one next step per node, `routes()` only from a router, a router only last in a
`chain`, a cycle needs a router with `maxVisits` (`router.unbounded-cycle`), a workflow start exists,
no unreachable node or dead end, nothing after a workflow finish.

## What nodes see

- An **agent** sees the task, the other agents' contributions and the thread's memory
  ([Memory Management](Memory-Management)); it answers through its own loop ([Agents](Agents)).
- An **action** (`@WorkflowAction`, code without a model) gets the state and its context:

<!-- snippet-context
import { WorkflowAction, type ActionContext } from "agboss";
-->

```ts
@WorkflowAction({ name: "audit-log", description: "Writes the run to the audit log" })
export class AuditLog {
  execute(_state: unknown, ctx: ActionContext) {
    console.log(`run ${ctx.run.runId} on thread ${ctx.run.threadId}: ${ctx.idempotencyKey}`);
    return {};
  }
}
```

## Testing

A workflow is tested end to end with scripted models — no network ([Testing](Testing)):

<!-- snippet-context
import { Agent, Router, Workflow, WorkflowFinish, WorkflowSettings, WorkflowStart, from, type WorkflowDefinition } from "agboss";
import { WorkflowFinishText, WorkflowStartText } from "agboss/dto";
@WorkflowStart({ name: "chat", description: "A message", input: WorkflowStartText })
class ChatStart { declare readonly input: WorkflowStartText; }
@WorkflowFinish({ name: "chat", description: "The answer", output: WorkflowFinishText })
class ChatFinish {}
@Agent({ name: "support", description: "Helps", prompt: "Help the customer.", model: "moonshotai/kimi-k2.6" })
class SupportAgent {}
@Router({ name: "main", description: "Routes", prompt: "Pick who handles the message.", model: "typesafe/jev-1.13", maxVisits: 3, routes: [{ prompt: "Support questions", target: SupportAgent }, { prompt: "Stop and send the answer: the message is answered", target: ChatFinish }] })
class MainRouter {}
@Workflow({ name: "support", version: "1.0.0", flow: [from(ChatStart).next(MainRouter), from(MainRouter).routes(), from(SupportAgent).next(MainRouter)], defaults: { models: { temperature: 0 }, router: { kind: "jev", model: "typesafe/jev-1.13" }, history: { limit: 5 } } })
class MainWorkflow implements WorkflowDefinition { settings() { return WorkflowSettings.builder().build(); } }
-->

```ts
import { expect } from "vitest";
import { replyWith, routeTo, testWith } from "agboss/testing";

const test = testWith(MainWorkflow);

test("a support question is answered by support", async ({ app, mockLlm }) => {
  mockLlm(MainRouter).thenReturn(routeTo(SupportAgent), routeTo(ChatFinish));
  mockLlm(SupportAgent).thenReturn(replyWith("Resolved"));

  const result = await app.execute(ChatStart, { text: "help" });

  expect(result).toFollowPath([ChatStart, MainRouter, SupportAgent, MainRouter, ChatFinish]);
  expect(result).toFinishWith(ChatFinish, { text: "Resolved" });
  expect(mockLlm(SupportAgent)).toHaveCalledTools([]);
});
```

## Nested workflows

A `@Workflow` class is a node of another workflow's flow: it runs as a subgraph from its own
workflow start to its own workflow finish, and returns only what it added (contributions, model
calls, steps and visits), so limits and spend hold across both. Its providers join the parent's
(a token registered differently by both fails with `[di.duplicate-token]`), and `mockLlm` of a child's
agent works in the parent's test.

<!-- snippet-context
import { Workflow, WorkflowSettings, from, type WorkflowDefinition } from "agboss";
declare class TaskStart {}
declare class AnswerFinish {}
declare class ChildStart {}
declare class ChildFinish {}
declare class DraftAgent {}
declare class GreeterAgent {}
const defaults = { models: { temperature: 0 }, router: { kind: "jev", model: "typesafe/jev-1.13" }, history: { limit: 5 } } as const;
-->

```ts
@Workflow({
  name: "greeting",
  version: "1.0.0",
  flow: [from(ChildStart).next(GreeterAgent), from(GreeterAgent).next(ChildFinish)],
  defaults,
})
export class GreetingWorkflow implements WorkflowDefinition {
  settings() {
    return WorkflowSettings.builder().build();
  }
}

@Workflow({
  name: "parent",
  version: "1.0.0",
  flow: [
    from(TaskStart).next(DraftAgent),
    from(DraftAgent).next(GreetingWorkflow), // the child runs here
    from(GreetingWorkflow).next(AnswerFinish),
  ],
  defaults,
})
export class ParentWorkflow implements WorkflowDefinition {
  settings() {
    return WorkflowSettings.builder().build();
  }
}
```

The path of a run shows the child's nodes after the workflow's node:
`[TaskStart, DraftAgent, GreetingWorkflow, ChildStart, GreeterAgent, ChildFinish, AnswerFinish]`.

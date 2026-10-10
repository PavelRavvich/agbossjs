# ADR-0017 — Fork-Join and Parallel Execution

- **Status:** Accepted (the DSL as shipped is below; the first proposal's `fork({...})` step was
  replaced by `nextParallel`)
- **Issue:** #155

## Context

GraphCompose workflows were linear. Real-world tasks need agents running in parallel and their
results synchronized before the run goes on — without implicit mutable state shared by the branches.

## Decision

1. **DSL**: fan-out and fan-in are flow steps — `from(A).nextParallel(B, C)` starts the branches,
   `from(B, C).join(D)` waits for all of them; `batchParallel(Target, Strategy, { concurrencyLimit,
   batchSize })` maps a target over items known only at run time; `joinQuorum(Strategy, { min, max?,
   timeoutSeconds? })` lets the run go on once enough branches voted. A router may start branches too
   (a route to `parallel(...)`, `optional(...)`).

<!-- snippet-context
import { Agent, BatchParallelStrategy, from, type Flow } from "graphcompose";
const model = "moonshotai/kimi-k2.6";
@Agent({ name: "planner", description: "Plans", prompt: "Plan.", model }) class PlannerAgent {}
@Agent({ name: "research", description: "Researches", prompt: "Research {{item}}.", model }) class ResearchAgent {}
@Agent({ name: "risks", description: "Finds risks", prompt: "Find risks.", model }) class RiskAgent {}
@Agent({ name: "synthesis", description: "Synthesizes", prompt: "Synthesize.", model }) class SynthesisAgent {}
@BatchParallelStrategy() class TopicsOfPlan { extract(): string[] { return ["a", "b"]; } }
export const flows: Flow[] = [
// @snippet
];
-->

```ts
[
  from(PlannerAgent).nextParallel(ResearchAgent, RiskAgent), // both branches run
  from(ResearchAgent, RiskAgent).join(SynthesisAgent), // waits for both
],
[
  from(PlannerAgent).batchParallel(ResearchAgent, TopicsOfPlan, { concurrencyLimit: 2, batchSize: 1 }),
  from(ResearchAgent).next(SynthesisAgent),
],
```

2. **Parallel execution with LangGraph's `Send` API**: a fork compiles into conditional edges that
   return one `Send` per branch; the branches run concurrently and the join is a barrier node.
3. **Results by name, not shared state**: each branch's output is kept under its node's name
   (`ForkOutput`: `{ name, data }`, internal types of `src/graph/fork-join.ts`); the joined target
   reads the branches' contributions, and a join node may implement `onJoin(outputs)` to turn them
   into contributions, payload or a state update. FinOps data (tokens, money) aggregate through the
   state's reducers and are not part of a branch's output.
4. **State**: a `payload` channel for custom key–value data next to the contributions.

## Consequences

- **Easier:** parallel routines are one flow step; the assembly rules check fan-outs and joins like
  every other step ([Workflow](Workflow), [Advanced Routing](Advanced-Routing)).
- **Harder:** the graph compiler manages `Send` objects, barriers, batches and quorums.
- **Watch:** contributions are multimodal (`Contribution.content` may hold parts), so joined branches
  can pass images as well as text.

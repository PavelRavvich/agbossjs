# Workflows & DSL

A workflow in GraphCompose is defined strictly through declarative connections between agents, routers, and finish targets. 
GraphCompose provides a strongly-typed fluent API (`from().*`) to build workflows using natural English-like sentences that are extremely easy to refactor, check statically, and visualize.

## Writing a Workflow

Workflows are mapped using combinations of `next()`, `nextParallel()`, `routeOne()`, `nextEach()`, and various `join()` operators. The framework strictly enforces safety, preventing dead ends, missing connections, and cycles where not explicitly allowed.

### 1. Linear Transitions
If an agent finishes its work and unconditionally passes control to another node:
```typescript
import { from } from "@graphcompose/core";
import { WorkflowContext, AgentState } from "@graphcompose/core";

export const flow = [
  // 1-to-1 Transition
  from(TaskStart).next(DataFetchAgent),
  
  // Implicitly passing the output from one agent to the next
  from(DataFetchAgent).next(CleaningAgent),
  from(CleaningAgent).next(AnalysisAgent)
];
```

### 2. Conditionals (Routers)
When a node requires LLM decision-making to pick where to go next, we use a `Router`. Routers conditionally transition to a **single** route from a predefined list.

```typescript
export const flow = [
  // The Router can transition to CoderAgent, TechLeadAgent, or Finish
  from(TaskStart).next(MainRouter),
  from(MainRouter).routeOne(CoderAgent, TechLeadAgent, Finish),

  // If the agent decides to go back to the router
  from(CoderAgent).next(MainRouter),
  from(TechLeadAgent).next(MainRouter),
];
```

You can also use `.routeOneOrSkip()` and `.routeManyOrSkip()` when the router is allowed to completely skip routing to any of the targets.
```typescript
from(ComplianceRouter).routeOneOrSkip(LegalAgent);


from(ExpertiseRouter).routeManyOrSkip(FinanceAgent, HrAgent, TechAgent, {
  maxChoices: 2,             // Maximum number of agents to invoke
  required: [FinanceAgent]   // FinanceAgent is ALWAYS invoked
})
```

### 3. Static Parallelism & Joining
To invoke multiple known agents at the same time:

```typescript
export const flow = [
  from(MainRouter).routeOne(FinanceAgent, HrAgent, TechAgent),

  // 1. Static Fan-out
  // Execute three distinct agents in parallel unconditionally
  from(PreparationAgent).nextParallel(FinanceAgent, HrAgent, TechAgent),

  // 2. Barrier (Join)
  // Wait for all three specific agents to finish before moving to Aggregator
  from(FinanceAgent, HrAgent, TechAgent).join(Aggregator),
];
```

*(Note: The `join` operation strictly expects exactly the array of agents specified. If an upstream router skipped one of the branches, or one of the branches hits a dead end, `join` will block forever. The framework checks for these deadlocks at compile time!)*

### 4. Dynamic Parallelism (Scatter / Gather)
If you need to process an unknown number of items (like chunks of a file, or dynamically extracted tasks), use `nextEach`. This acts as a Map-Reduce step.

```typescript
export const flow = [
  // Map Step: Scatter dynamic sub-tasks to the ResearchAgent
  // The second argument is an extractor function receiving the current state.
  from(TaskDecompositionAgent).nextEach(ResearchAgent, (state: AgentState<DecompositionSchema>) => {
    return state.payload.tasks.map(task => ({
      ...state,
      payload: task // Pass the specific sub-task down
    }));
  }),

  // Reduce Step: Gather all dynamically nextEached ResearchAgent outputs
  from(ResearchAgent).join(ReportAgent)
];
```

### 5. Partial Synchronizations (Quorum and Any)
If you do not want to wait for all parallel branches to finish, you can wait for any of them, or a specific subset.

```typescript
export const flow = [
  from(PreparationAgent).nextParallel(WorkerA, WorkerB, WorkerC),

  // Fast path: Proceed as soon as ANY of the 3 finishes
  from(WorkerA, WorkerB, WorkerC).joinAny(FastAggregator),
  
  // Consensus path: Proceed as soon as at least 2 finish
  from(WorkerA, WorkerB, WorkerC).joinQuorum(ConsensusAggregator, { min: 2 }),
];
```

## State Strictness (`WorkflowContext` and `AgentState<T>`)

No `any` is allowed in run loops or workflows! You must strongly type your state using `AgentState<T>` for individual payload structures, or `WorkflowContext` for overall execution states.

```typescript
import { AgentState, WorkflowContext } from "@graphcompose/core";

export class DataFetchAgent {
  // Always strongly type the state 
  async run(state: AgentState<FetchRequestSchema>, ctx: WorkflowContext) {
    const data = await fetch(state.payload.url);
    
    // ...
  }
}
```


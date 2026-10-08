# DSL Routing & Parallelism (Phase 2 Specification)

This document serves as a cheat sheet and specification for the GraphCompose DSL `flow:` block, detailing all capabilities for routing, parallelism, and barrier synchronization.

## 1. Sequential Execution (Linear Pipeline)
The simplest scenario. Agents unconditionally pass execution to the next node in the chain.

```typescript
flow: [
  from(StartNode).next(AgentA),
  from(AgentA).next(AgentB),
  from(AgentB).next(FinishNode)
]
```

## 2. Static Parallelism (Fork & Join)
Hardcoded branching. The graph unconditionally splits into a known number of paths and waits for all of them.

```typescript
flow: [
  from(StartNode).next(PreparationAgent),
  
  // Branch into 3 parallel paths
  // Note: you can use required() or background() to indicate if the main execution should wait for this branch
  from(PreparationAgent).nextParallel({
    awaiting: [AgentA, AgentB],
    fireAndForget: [AgentC]
  }),
  
  // Barrier: waits for all 3 branches to finish
  from(AgentA, AgentB, AgentC).join(AggregatorAgent),
  
  from(AggregatorAgent).next(FinishNode)
]
```


## 3. Detached Branching (Awaiting vs Fire-and-Forget)
When splitting a process into multiple independent paths (not a map-reduce fork, but true structural branching), you use `nextParallel`. You can specify which branches the main execution should wait for (`required`) and which can be run asynchronously in a fire-and-forget manner (`background`).

```typescript
flow: [
  from(StartNode).next(OnboardingAgent),

  // Branch the process into two independent tasks
  from(OnboardingAgent).nextParallel({
    awaiting: [MainAgent],           // The user waits for this branch to finish
    fireAndForget: [AnalyticsAgent]  // Runs in the background, doesn't block the execution output
  }),
  
  // They don't need a join! They go to their own separate finishes:
  from(MainAgent).next(SuccessFinish),
  from(AnalyticsAgent).next(SilentlyFinish)
]
```
*Note: True early-return execution for background branches relies on engine-level support; otherwise it defaults to standard parallel execution.*

## 4. Dynamic Parallelism (Scatter-Gather / MapEach / BatchParallel)
The number of parallel branches is unknown until runtime (data-dependent). GraphCompose uses LangGraph's `Send` API under the hood to dynamically spawn N instances of an agent.

To preserve Dependency Injection and clean architecture, the extraction logic is placed in a dedicated `@BatchStrategy` class, rather than an inline lambda.

```typescript
import { BatchStrategy, type BatchParallelStrategy } from "graphcompose/concurrency";

// The strategy decides WHICH elements are sent to the dynamic agents
@BatchStrategy({ name: "url_extractor" })
export class UrlExtractor implements BatchParallelStrategy<MyState, string> {
  // Supports DI!
  constructor(private readonly filterService: FilterService) {}

  extract(state: MyState): string[] {
    return this.filterService.filterUrls(state.urls);
  }
}
```

```typescript
flow: [
  from(WorkflowStart).next(DispatcherAgent),
  
  // Extracts an array from the state via the DI Strategy class.
  // Spawns a ScraperAgent for each element, limited to 5 concurrent instances.
  // The join barrier automatically waits for all spawned instances to finish.
  from(DispatcherAgent)
    .batchParallel(ScraperAgent, UrlExtractor, { concurrency: 5 }),
    
  from(ScraperAgent).join(SummaryAgent),
    
  from(SummaryAgent).routes(WorkflowFinish)
]
```

## 7. Routing: Strict Choice (XOR)
The router analyzes the payload and must choose **strictly one** of the provided paths.

```typescript
flow: [
  from(StartNode).next(ValidatorRouter),
  
  // Either success or error (cannot run concurrently)
  from(ValidatorRouter).routeOne(SuccessAgent, ErrorAgent),
  
  // The barrier will wait for whichever path was chosen
  from(SuccessAgent, ErrorAgent).join(Finalizer),
  from(Finalizer).next(FinishNode)
]
```

## 5. Routing: Optional Branch (routeOneOrSkip)
The classic "call an expert if needed, otherwise skip" scenario.

```typescript
flow: [
  from(StartNode).nextParallel(MainWorker, ComplianceRouter),
  
  // The router either directs to LegalAgent, or cancels this branch (Skip)
  from(ComplianceRouter).routeOneOrSkip(LegalAgent),
  
  // Finalizer will wait for MainWorker and LegalAgent.
  // If Legal was skipped, the barrier detects the 'aborted' status and proceeds without deadlocking.
  from(MainWorker, LegalAgent).join(Finalizer),
  from(Finalizer).next(FinishNode)
]
```

## 6. Routing: Multiple Choice with Constraints
A router can launch multiple branches in parallel. Any unselected branches are automatically skipped.

```typescript
flow: [
  from(StartNode).next(ExpertiseRouter),
  
  // Choose any subset of the 3 paths. Provide constraints to the LLM router.
  from(ExpertiseRouter).routeManyOrSkip(FinanceAgent, HrAgent, TechAgent, {
    maxChoices: 2,             // Cannot pick more than 2
    required: [FinanceAgent]   // Finance must always be included
  }),
  
  // Wait only for the branches the router actually launched (others are skipped)
  from(FinanceAgent, HrAgent, TechAgent).join(Aggregator),
  from(Aggregator).next(FinishNode)
]
```

## 8. Custom Barriers (QuorumRouter)

The `@QuorumRouter` is a specialized routing node in GraphCompose designed to act as an active synchronization barrier (fan-in) for parallel branches. Unlike a simple `.join()` which waits for all parallel agents to finish, `.joinQuorum()` actively monitors results as they come in, allowing for powerful short-circuiting, timeouts, and "Fail-Fast" behavior.

### Configuration & Scenarios

Configuration is supplied at the point of graph assembly to maximize router reusability:

```typescript
from(Worker1, Worker2, Worker3)
  .joinQuorum(SecurityQuorum, { 
    min: 2, 
    max: 3, 
    timeoutSeconds: 30 
  })
```

Depending on how you combine `min`, `max`, and `timeoutSeconds`, the framework intelligently adapts its behavior. Here are the 4 primary scenarios:

#### 1. Only `{ min: X }`
*(Under the hood, `max` automatically equals `min`)*
- **Early Success:** As soon as `min` votes are gathered, the remaining agents are aborted, and the router proceeds with `hasQuorum = true`.
- **Fail-Fast:** If too many agents vote "No" and it becomes mathematically impossible to reach `min`, the remaining agents are aborted, and the router proceeds with `hasQuorum = false`.

#### 2. `{ min: X, max: Y }` (No Timeout)
*Use case: "I want `Y` votes for a perfect consensus, but I'll settle for `X` if the others fail."*
- **Keep Waiting:** If we reach `min`, we **do not** abort the others yet. We keep waiting in hopes of reaching `max`.
- **Early Success:** As soon as we reach `max`, we abort the remaining agents and proceed with `hasQuorum = true`.
- **Natural Finish:** If all agents finish and we gathered between `min` and `max` votes, we proceed with `hasQuorum = true`. If we gathered `< min`, we proceed with `hasQuorum = false`.

#### 3. `{ min: X, max: Y, timeoutSeconds: Z }`
*Use case: "Try to get a perfect `Y` consensus quickly, but if `Z` seconds pass, just check if we at least got `X`."*
- **Early Success:** If `max` votes are gathered before the timeout, abort the rest and proceed with `hasQuorum = true`.
- **Timeout Triggered:** If `Z` seconds pass, abort the remaining agents. Evaluate what was gathered: if `votes >= min`, proceed with `hasQuorum = true`. Otherwise, `hasQuorum = false`.
- **Fail-Fast:** If too many negative votes come in early, we don't even wait for the timeout. We abort immediately with `hasQuorum = false`.

#### 4. `{ min: X, timeoutSeconds: Z }`
*(Under the hood, `max` automatically equals `min`)*
- **Early Success:** As soon as `min` votes are gathered, abort the rest and proceed with `hasQuorum = true`. We **do not** wait for the timeout.
- **Timeout Triggered:** If `Z` seconds pass, it means we haven't reached `min` yet. Abort the remaining agents and proceed with `hasQuorum = false`.

### Complete Example

```typescript
import { 
  Agent, Workflow, QuorumRouter, type QuorumStrategy, 
  from, Append, Tool, type ToolHandler, WorkflowStart, WorkflowFinish 
} from "graphcompose";

@QuorumRouter({ name: "security_quorum" })
class SecurityQuorum implements QuorumStrategy<CodeAuditState> {
  // Evaluated every time ANY agent finishes
  filterVote(state: CodeAuditState): boolean {
    const latestReport = state.reports.at(-1);
    return latestReport?.severity === "CRITICAL";
  }
  
  // Evaluated ONCE when the quorum terminates
  route(state: CodeAuditState, hasQuorum: boolean) {
    if (hasQuorum) {
      console.warn("Quorum reached! Halting release.");
      return EmergencyLockdown; 
    }
    console.log("Code is safe (or quorum failed), proceeding.");
    return FinishAudit;
  }
}

@Workflow({
  name: "security_audit",
  version: "1.0.0",
  flow: [
    from(CodeAuditState).nextParallel(StaticAnalyzer, DynamicAnalyzer, DependencyChecker, PenTester),
    
    // The active barrier
    from(StaticAnalyzer, DynamicAnalyzer, DependencyChecker, PenTester)
      .joinQuorum(SecurityQuorum, { 
        min: 2,                 // We need at least 2 critical reports
        max: 3,                 // If we get 3, stop immediately
        timeoutSeconds: 45      // Don't wait longer than 45s for the slow agents
      })
      .routes(EmergencyLockdown, FinishAudit), 
      
    from(EmergencyLockdown).next(FinishAudit)
  ]
})
class SecurityAuditWorkflow {}
```

## 9. Strong Typing Concepts

- **`AgentOutput<T>`**: An interface for Agents to declare their output DTO shape, giving strict typing to `.batchParallel(..., Strategy)`.
- **`JoinArray<T>`**: A type alias (`Array<ForkOutput<T>>`) that hides generic complexity when writing a `JoinHandler` for dynamic parallelism.
- **`AgentState<T>`**: Wraps LangGraph's global state, providing strict type-safety over the `payload` property inside an agent's `run` method.
- **`WorkflowContext`**: Replaces the generic `FlowContext`, providing access to infrastructure (like `context.store` for large artifact saving without bloating the graph state).

## 10. Nested Workflows (Subgraphs)

GraphCompose supports composing workflows by nesting them as subgraphs. A `@Workflow` class can be passed directly to routing methods like `.next()` or `.batchParallel()`, just like a regular Agent.

When nesting workflows, state isolation is handled automatically. The subgraph runs within its own local state limits, resets path/steps counters, and interacts with the global `SpendLedger` for tracking token usage.

```typescript
import { Workflow, from, WorkflowStart, WorkflowFinish } from "graphcompose";

// Define a Subgraph
@Workflow({
  name: "sub_workflow",
  flow: [
    from(WorkflowStart).next(WorkerAgent),
    from(WorkerAgent).next(WorkflowFinish)
  ]
})
class SubWorkflow {}

// Use it in a Parent Workflow
@Workflow({
  name: "parent_workflow",
  flow: [
    from(WorkflowStart).next(StartAgent),
    
    // Call the SubWorkflow directly
    from(StartAgent).next(SubWorkflow),
    
    // The subgraph's WorkflowFinish passes control back to the parent
    from(SubWorkflow).next(WorkflowFinish)
  ]
})
class ParentWorkflow {}
```

## 11. Error Routing (`catchError`)

You can declare fallback paths for specific error types using the `catchError` syntax. If an Agent throws an error, execution can be routed to a specific FallbackAgent rather than failing the entire workflow.

```typescript
import { Workflow, from, WorkflowStart, WorkflowFinish } from "graphcompose";

class NetworkError extends Error {}

@Workflow({
  name: "error_handling_workflow",
  flow: [
    from(WorkflowStart).next(RiskyAgent),
    
    // Normal success path
    from(RiskyAgent).next(SuccessAgent),
    
    // Error routing path
    catchError(RiskyAgent, NetworkError).next(FallbackAgent),
      
    from(SuccessAgent).next(WorkflowFinish),
    from(FallbackAgent).next(WorkflowFinish)
  ]
})
class ErrorHandlingWorkflow {}
```

## 12. SAGA Orchestration

GraphCompose supports SAGA patterns for distributed transactions. You can specify a compensating agent for any agent using the `compensate` property in the `@Agent` metadata. The `SagaOrchestrator` can then be used to trigger rollbacks if a subsequent step fails.

```typescript
import { Agent, Workflow, from, SagaOrchestrator, WorkflowStart, WorkflowFinish } from "graphcompose";

// Define a compensating Agent
@Agent({ name: "cancel_payment_agent" })
class CancelPaymentAgent {
  async run(state: MyState) {
    // Logic to refund or cancel payment
  }
}

// Define the primary Agent with a compensation link
@Agent({
  name: "process_payment_agent",
  compensate: CancelPaymentAgent
})
class ProcessPaymentAgent {
  async run(state: MyState) {
    // Logic to process payment
  }
}

@Agent({ name: "failing_inventory_agent" })
class FailingInventoryAgent {
  async run(state: MyState) {
    throw new Error("Inventory check failed!");
  }
}

@Workflow({
  name: "saga_workflow",
  flow: [
    from(WorkflowStart).next(ProcessPaymentAgent),
    from(ProcessPaymentAgent).next(FailingInventoryAgent),
    
    // Catch the error and trigger the SAGA rollback
    catchError(FailingInventoryAgent, Error).next(SagaOrchestrator),
      
    // SagaOrchestrator will automatically invoke CancelPaymentAgent
    from(SagaOrchestrator).next(WorkflowFinish)
  ]
})
class SagaWorkflow {}
```

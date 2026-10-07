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

## 4. Dynamic Parallelism (Scatter-Gather / MapEach)
The number of parallel branches is unknown until runtime (data-dependent).

```typescript
flow: [
  from(StartNode).next(DispatcherAgent),
  
  // Extracts an array from the state (p.urls) and spawns a ScraperAgent for each element.
  // The join barrier automatically waits for all spawned instances.
  from(DispatcherAgent)
    .nextParallel(ScraperAgent, p => p.urls)
    .join(SummaryAgent),
    
  from(SummaryAgent).next(FinishNode)
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

- **`AgentOutput<T>`**: An interface for Agents to declare their output DTO shape, giving strict typing to `.nextParallel(..., p => p.items)`.
- **`JoinArray<T>`**: A type alias (`Array<ForkOutput<T>>`) that hides generic complexity when writing a `JoinHandler` for dynamic parallelism.
- **`AgentState<T>`**: Wraps LangGraph's global state, providing strict type-safety over the `payload` property inside an agent's `run` method.
- **`WorkflowContext`**: Replaces the generic `FlowContext`, providing access to infrastructure (like `context.store` for large artifact saving without bloating the graph state).

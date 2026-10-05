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
  
  // Fork into 3 parallel branches
  from(PreparationAgent).nextParallel(AgentA, AgentB, AgentC),
  
  // Barrier: waits for all 3 branches to finish
  from(AgentA, AgentB, AgentC).join(AggregatorAgent),
  
  from(AggregatorAgent).next(FinishNode)
]
```

## 3. Dynamic Parallelism (Scatter-Gather / MapEach)
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

## 4. Routing: Strict Choice (XOR)
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

## 7. Custom Barriers (Race & Quorum)
Special cases for merging parallel branches where we don't need to wait for everyone.

```typescript
flow: [
  from(StartNode).nextParallel(Worker1, Worker2, Worker3),
  
  // Option A: Race condition. The first one to answer wins.
  from(Worker1, Worker2, Worker3).joinAny(FastAggregator),
  
  // Option B: Quorum. Proceed as soon as any 2 out of 3 agents respond.
  from(Worker1, Worker2, Worker3).joinQuorum(2, SafeAggregator)
]
```

## 8. Strong Typing Concepts

- **`AgentOutput<T>`**: An interface for Agents to declare their output DTO shape, giving strict typing to `.nextParallel(..., p => p.items)`.
- **`JoinArray<T>`**: A type alias (`Array<ForkOutput<T>>`) that hides generic complexity when writing a `JoinHandler` for dynamic parallelism.
- **`AgentState<T>`**: Wraps LangGraph's global state, providing strict type-safety over the `payload` property inside an agent's `run` method.
- **`WorkflowContext`**: Replaces the generic `FlowContext`, providing access to infrastructure (like `context.store` for large artifact saving without bloating the graph state).

# ADR-0017 — Fork-Join and Parallel Execution

- **Status:** Accepted
- **Issue:** #155

## Context

GraphCompose workflows are currently linear. Real-world tasks require running agents in parallel and synchronizing their results before proceeding.

We need an explicit `fork-join` construct in the workflow DSL, and a way for the joined target to receive the results from the executed branches cleanly, without implicit mutable state pollution.

## Decision

1. **DSL Syntax**: We introduce `fork()` and `join()` methods to the Flow DSL:
   ```ts
   from(PlannerAgent)
     .fork({ research: ResearchAgent, risks: RiskAgent }, { maxConcurrent: 2 })
     .join(SynthesisAgent)
   ```

2. **Parallel execution with `Send` API**: The `fork` step compiles into LangGraph conditional edges that return multiple `Send` instances, executing branches simultaneously and natively waiting for all to finish.

3. **System Types (`ForkOutput`, `ForkOutputs`, `JoinOutput`, `JoinHandler`)**:
   We provide strict, cleanly mapped generic wrappers to avoid string-parsing boilerplate:
   
   - **`ForkOutput<T>`**: Represents the output of a single executed branch.
     ```ts
     export interface ForkOutput<T = string> {
       readonly data: T;      // Agent text or DTO from a WorkflowAction
       readonly name: string; // Executed node name
     }
     ```
   
   - **`ForkOutputs<T>`**: A mapped type utility that wraps the keys of the expected object.
     ```ts
     export type ForkOutputs<T> = { [K in keyof T]: ForkOutput<T[K]> };
     ```

   - **`JoinOutput`**: The unified response object returned by the join handler.
     ```ts
     export interface JoinOutput {
       // New messages added to the common thread. `agent` is optional (defaults to current node).
       readonly contributions?: { agent?: string; content: string }[]; 
       // Custom business data passed to state.payload
       readonly payload?: Record<string, unknown>; 
       // Direct diff applied to LangGraph state
       readonly update?: FlowStateUpdate; 
     }
     ```

   - **`JoinHandler<T>`**: The interface implemented by the consumer node.
     ```ts
     export interface JoinHandler<T extends Record<string, ForkOutput<unknown>>> {
       onJoin(outputs: T): JoinOutput;
     }
     ```

4. **AgentState additions**: 
   We add `payload: Annotation<Record<string, unknown>>` to `AgentState` to store custom developer KV data. FinOps data (tokens, money) natively aggregates in `FlowState` via existing LangGraph reducers and is explicitly excluded from `ForkOutput`.

## Consequences

- **Easier:** Developing parallel routines. Explicit API via `JoinHandler` and `ForkOutputs` makes data aggregation entirely type-safe.
- **Harder:** The graph compiler (`build.ts`) becomes slightly more complex, managing mapped `Send` objects.
- **Watch:** Multimodal model support (changing `Contribution.content` from `string` to objects) must be implemented prior to this, to ensure `JoinOutput.contributions` can seamlessly pass arrays of multimodal content.

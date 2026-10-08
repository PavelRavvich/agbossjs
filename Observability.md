# Observability

GraphCompose introduces a powerful, duck-typed Observability engine and Hook system (introduced in #169 and #173) that allows you to monitor and trace executions across your workflows.

## The Duck-Typed Hook Interfaces

The observability system is built on a set of duck-typed hook interfaces found in `src/core/observability.ts`. These hooks span across all execution layers of GraphCompose:
- `OnWorkflowStart` / `OnWorkflowEnd`
- `OnAgentStart` / `OnAgentEnd`
- `OnToolStart` / `OnToolEnd`
- `OnActionStart` / `OnActionEnd`
- `OnGuardrailStart` / `OnGuardrailEnd`
- `OnPiiPolicyStart` / `OnPiiPolicyEnd`
- `OnChannelStart` / `OnChannelEnd`
- `OnModelStart` / `OnModelEnd`
- `OnError`
*(and more, such as `OnRouterStart` or `OnRagStart`)*

By implementing these methods on any injectable class, GraphCompose will automatically invoke them during the lifecycle of the respective component.

## Context and Generics

Hooks receive context objects that provide detailed information about the state of execution. The core types used are `AgentContext<I = unknown>` for the start of an execution and `AgentContextUpdate<U = unknown>` for the end of an execution (with similar types existing for Routers, Tools, Actions, etc.).

These context objects use Generics to strictly type the data coming into the hook:
- `AgentContext.input`: Contains the initial input to the component (for example, `state.task` or a specific message payload).
- `AgentContextUpdate.update`: Contains the actual return value or state update produced by the component.

Both interfaces also include the `state` property, which gives you access to the overall `AppState` (including `runId`, `threadId`, `activeNode`, etc.), allowing for robust tracing and correlation.

## Injecting an Observer

To inject an observer into your workflow, you simply:
1. Create a class and decorate it with `@Injectable()`.
2. Implement the desired hook methods.
3. Pass the class to the `providers` array in your `@Workflow` decorator.

GraphCompose's Dependency Injection system automatically wires up the class to listen to the matching events.

## Example: DatadogTracer

Here is an example of an observer that traces Agent executions and errors, simulating how you might integrate with a platform like Datadog:

```typescript
import { Injectable } from '@graphcompose/core';
import { 
  OnAgentStart, 
  OnAgentEnd, 
  OnError, 
  AgentContext, 
  AgentContextUpdate, 
  AppState 
} from '@graphcompose/core/observability';

@Injectable()
export class DatadogTracer implements OnAgentStart, OnAgentEnd, OnError {
  
  onAgentStart(ctx: AgentContext<{ task: string }>): void {
    console.log(`[Datadog] Starting trace for Agent: ${ctx.name} | RunID: ${ctx.state.runId}`);
    // Simulate setting tags for the active span
    // datadog.tracer.startSpan('agent.run').setTag('agent.name', ctx.name);
  }

  onAgentEnd(ctx: AgentContextUpdate<{ result: string }>): void {
    console.log(`[Datadog] Finishing trace for Agent: ${ctx.name} | Output: ${ctx.update.result}`);
    // datadog.tracer.activeSpan()?.finish();
  }

  onError(error: Error, state: AppState): void {
    console.error(`[Datadog] Error tracked in RunID: ${state.runId}`, error);
    // datadog.tracer.activeSpan()?.setTag('error', error).finish();
  }
}
```

# Observability

Observers see a run's events: workflow, agent, router, tool, model, knowledge base, guardrail, PII
policy, action, channel and judge start / end, and errors. They are registered, not discovered: only
classes listed in `@Workflow({ observers: [...] })` are called. Tracing to Langfuse is built in
([Tracing](Tracing)); observers are for everything else (metrics, your own tracer, audit).

## The hooks

Each hook is its own interface with a typed payload (root entry `agboss`):

| Hook interfaces                         | Payload                                                         |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `OnWorkflowStart` / `OnWorkflowEnd`     | `AppState` / the `ExecutionOutput` and `AppState`               |
| `OnWorkflowPause` / `OnWorkflowResume`  | `WorkflowPauseEvent` (pause) / `WorkflowResumeEvent` (decision) |
| `OnAgentStart` / `OnAgentEnd`           | `AgentStartEvent` / `AgentEndEvent`                             |
| `OnRouterStart` / `OnRouterEnd`         | `RouterStartEvent` / `RouterEndEvent`                           |
| `OnToolStart` / `OnToolEnd`             | `ToolStartEvent` (tool, agent, arguments) / `ToolEndEvent`      |
| `OnModelStart` / `OnModelEnd`           | `ModelStartEvent` / `ModelEndEvent` (model, usage, cost)        |
| `OnRagStart` / `OnRagEnd`               | `RagStartEvent` / `RagEndEvent`                                 |
| `OnActionStart` / `OnActionEnd`         | `ActionStartEvent` / `ActionEndEvent`                           |
| `OnGuardrailStart` / `OnGuardrailEnd`   | `GuardrailStartEvent` / `GuardrailEndEvent`                     |
| `OnPiiPolicyStart` / `OnPiiPolicyEnd`   | `PiiPolicyStartEvent` / `PiiPolicyEndEvent`                     |
| `OnChannelStart` / `OnChannelEnd`       | `ChannelStartEvent` / `ChannelEndEvent`                         |
| `OnJudgeStart` / `OnJudgeEnd`           | `JudgeStartEvent` / `JudgeEndEvent`                             |
| `OnError`                               | the `Error` and `AppState`                                      |
| `OnRunRejected`                         | `RunRejectedEvent` (operation, threadId?, code, message)        |

Every event carries the run's `state` (`AppState`: `runId`, `threadId`, `activeNode`, …) for
correlation: one `runId` for the whole run (its resumes included) and the conversation's real
`threadId`.

`onWorkflowStart` fires once per run, at `execute` — a resume does not start the run again, so the
count of starts is the count of runs. A run that pauses (an approval on a channel) emits
`onWorkflowPause` (`event.pause`: what it waits for) instead of `onWorkflowEnd`; `app.resume`
emits `onWorkflowResume` (`event.decision`). `onWorkflowEnd` / `onError` fire when the run finishes
or fails, also after a resume. Cancelling a paused run (`app.cancel`) emits `onError` with
`WorkflowCancelledError`. A run with one approval: start → pause → resume → end.

## Refused requests

A request the app refuses before a run starts or is located emits `onRunRejected` and is still
thrown to the caller. `RunRejectedEvent` carries the `operation` (`"execute"`, `"resume"` or
`"cancel"`), the `threadId` the request named (absent for an `execute` without one), the error's
stable `code`, a `message` without the input values, and `state` (the thread only). It never carries
a `runId`: no run started, and another owner's run is not revealed.

| Refusal                                         | Operation                     | `code`                 |
| ------------------------------------------------- | -------------------------------- | ------------------------- |
| a thread of another owner (`ThreadOwnerError`)  | `execute`, `resume`, `cancel` | `run.thread-owner`     |
| nothing paused on the thread (`NotPausedError`) | `resume`                      | `run.not-paused`       |
| an unknown thread (`UnknownThreadError`)        | `execute`                     | `run.unknown-thread`   |
| a class that is not a start of the workflow     | `execute`                     | `workflow.not-a-start` |
| an invalid start input (`DtoValidationError`)   | `execute`                     | `dto.invalid`          |

For an invalid start input the message names the DTO and its fields (`invalid Voucher at code`),
never their values; the thrown error keeps the full message. A resume refused after a deploy
(`IncompatibleResumeError`) is not a refused request: the paused run is known, so it is an `onError`
with that run's `runId` and thread, and the run stays paused — resumable by an app whose
`onIncompatibleResume` policy accepts it. A run whose day's budget is already spent does start
(`onWorkflowStart`, its own `runId`) and fails at once with `onError` (`BudgetExceededError`).

```ts
import { Injectable, type OnRunRejected, type RunRejectedEvent } from "agboss";

@Injectable()
export class Audit implements OnRunRejected {
  onRunRejected(event: RunRejectedEvent) {
    console.warn(`${event.operation} refused on ${event.threadId ?? "a new thread"}: ${event.code}`);
  }
}
```

## Registering an observer

1. A class decorated with `@Injectable()` (its `deps` injected like any component).
2. It implements the hooks it needs.
3. It is listed in `@Workflow({ observers })`.

The container creates observers at app start. Assembly rejects an observer with no hook
(`[observer.no-hooks]`) or a misspelled one (`[observer.unknown-hook]`, `did you mean onToolEnd?`). An
observer that throws is reported as a process warning and never fails the run.

## Example: a tracer

<!-- snippet-context
declare class ChatWorkflowStart {}
declare class SupportAgent {}
declare class ChatWorkflowFinish {}
-->

```ts
import {
  Injectable,
  Workflow,
  WorkflowSettings,
  chain,
  type AgentEndEvent,
  type AgentStartEvent,
  type AppState,
  type ModelEndEvent,
  type OnAgentEnd,
  type OnAgentStart,
  type OnError,
  type OnModelEnd,
  type WorkflowDefinition,
} from "agboss";

@Injectable()
export class ConsoleTracer implements OnAgentStart, OnAgentEnd, OnModelEnd, OnError {
  onAgentStart(event: AgentStartEvent) {
    console.log(`[trace] agent ${event.name} started in run ${event.state.runId}`);
  }

  onAgentEnd(event: AgentEndEvent) {
    console.log(`[trace] agent ${event.name} finished in run ${event.state.runId}`);
  }

  onModelEnd(event: ModelEndEvent) {
    console.log(`[trace] ${event.callerName} → ${event.model}: ${String(event.usage.totalTokens)} tokens`);
  }

  onError(error: Error, state: AppState) {
    console.error(`[trace] run ${state.runId} failed`, error);
  }
}

@Workflow({
  name: "support",
  version: "1.0.0",
  flow: [chain(ChatWorkflowStart, SupportAgent, ChatWorkflowFinish)],
  defaults: {
    models: { temperature: 0 },
    router: { kind: "jev", model: "typesafe/jev-1.13" },
    history: { limit: 5 },
  },
  observers: [ConsoleTracer],
})
export class Support implements WorkflowDefinition {
  settings() {
    return WorkflowSettings.builder().build();
  }
}
```

# App — `createApp`

A workflow, built and started: its container (every component, DI), its graph (every assembly rule —
**all** violations at once, before any model call) and the components' `onStart` hooks. The CLI
(`gc chat`, `gc run`) and the tests ([Testing](Testing)) use the same `app`.

<!-- snippet-context
import { WorkflowStart } from "graphcompose";
import { WorkflowStartText } from "graphcompose/dto";
@WorkflowStart({ name: "chat", description: "A message", input: WorkflowStartText })
class ChatWorkflowStart { declare readonly input: WorkflowStartText; }
declare class JobScout { settings(): import("graphcompose").WorkflowSettings }
-->

```ts
import { createApp } from "graphcompose";

const app = await createApp(JobScout); // optional: { env: "staging", profile: "scout-low-thinking" }

const first = await app.execute(ChatWorkflowStart, { text: "save the first job" });
if (first.status === "paused") {
  await app.resume(first.thread, { approved: true, by: "dana" });
}
const next = await app.execute(
  ChatWorkflowStart,
  { text: "and the second" },
  { thread: first.thread },
);
console.log(next.output?.text, next.spend.totalUsd);

await app.close(); // onStop hooks, MCP servers, tracing
```

## `app.execute(Start, input, options?)`

- `Start` must be a `@WorkflowStart` of this workflow (else `NotAWorkflowStartError`); `input` is
  typed by the start's `declare readonly input` and checked against its DTO before any call
  (`DtoValidationError`).
- Options: `thread` continues a conversation (without it a new thread is created; its id is in the
  result), `owner` (a thread created with an owner rejects another one — `ThreadOwnerError`),
  `signal`, `metadata` (strings, kept by the run's resumes), `onStream` (token and tool-call events),
  `configurable` (extra LangGraph keys). See [Context and Authorization](Context-And-Authorization).

## The result — `ExecutionOutput`

| Field                                                                 | What it holds                                                                      |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `thread`                                                              | the conversation id — pass it to the next `execute` or to `resume`                 |
| `finish`                                                              | the name of the `@WorkflowFinish` the run reached (absent when paused or guarded)  |
| `output`                                                              | the finish's data (`WorkflowFinishText`: `{ text }`)                               |
| `pause`                                                               | what the run waits for — the tool call waiting for approval (`agent`, `tool`, `args`) |
| `path`                                                                | the flow nodes it visited, in order, as classes / named nodes                      |
| `spend`                                                               | the `CostReport` of this run ([FinOps](FinOps))                                    |
| `status`, `replyWith`, `route`, `stopReason`, `compacted`, `traceUrl` | what the CLI prints                                                                |

A run that fails (a limit, a router, an agent) throws a `GraphComposeError` with a stable `code`;
the Tern and the spend are recorded first.

## `app.resume(thread, decision)`

Continues the paused run of the thread with a `ToolCallApprovalDecision` (`approved`, `by`,
`reason?` — [Pause seam](Pause-seam)); same result shape. A thread without a paused run →
`NotPausedError`. A run paused under another workflow version or config is checked by the
workflow's `onIncompatibleResume` policy (`IncompatibleResumeError`).

## `app.cancel(thread)`

Aborts a running run — it stops before its next model or tool call and `execute` rejects with
`WorkflowCancelledError` — or drops a paused one, whose `resume` then throws `NotPausedError`;
`{ cancelled }` is `false` when the thread had neither ([Saga and cancellation](Saga-And-Cancellation)).

## `app.close()`

Runs `onStop` of the components (dependants first; every hook runs, failures are reported together),
closes MCP connections and tracing, and the stores the app opened. Calling it twice is fine.

## Lifecycle hooks

A component the container creates (an `@Injectable` service, a tool, a knowledge base) may implement
`OnStart` / `OnStop`; a run-scoped one `OnDestroy`:

```ts
import { Injectable, type OnStart, type OnStop } from "graphcompose";

@Injectable()
export class Boards implements OnStart, OnStop {
  async onStart(): Promise<void> {
    /* open a pool */
  }
  async onStop(): Promise<void> {
    /* close it */
  }
}
```

`onStart` runs when the app is built (dependencies first), `onStop` when it closes. Values
(`provide(TOKEN, value)`) and test mocks have no hooks.

## Options — every part replaceable

`createApp(Workflow, options)` and `createAppDeps(bundle, options)` take the same parts; anything not
given is the production default:

| Option                    | Default                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `env`                     | `dev` — the environment file to load ([Configuration](Configuration#environments))                      |
| `environment`             | the values of that file (give them directly instead)                                                     |
| `processEnv`              | `process.env` (provider keys, `fromEnv` variables)                                                       |
| `gateway`                 | the model providers of the workflow's `settings()` — the one model-call seam                             |
| `transport`               | MCP stdio / streamable HTTP from the server's config                                                     |
| `connectMcp`              | connect every server, check its contract (fail fast)                                                     |
| `stores`                  | `checkpointer` (memory), `ledger` (files), `terns` (SQLite) — given stores stay open on `close`          |
| `clock`                   | the system clock (the ledger's UTC day, Tern times)                                                      |
| `newThreadId`, `newRunId` | random UUIDs                                                                                             |
| `container`               | `overrides` (values instead of classes — test mocks), `onCreate`                                         |
| `pausedRuns`              | in memory, this app only (`createSqlitePausedRunRepository(path)` keeps them across restarts)           |
| `profile`, `profileRoot`  | none ([Profiles and comparisons](Profiles-and-comparisons))                                              |

`graphcompose/testing` builds its apps with these: a scripted gateway, stubbed MCP servers, memory
stores, a test clock, deterministic ids.

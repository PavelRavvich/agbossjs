# App — `createApp`

A workflow, built and started: its container (every component, DI), its graph (every assembly rule —
**all** violations at once, before any model call) and the components' `onStart` hooks. The CLI
(`gc chat`, `gc run`) and the tests ([Testing](Testing)) use the same `app`.

```ts
import { createApp } from "graphcompose";

const app = await createApp(JobScout); // optional: { profile: "scout-low-thinking" }

const first = await app.run(ChatWorkflowStart, { text: "save the first job" });
if (first.pause !== undefined) {
  const done = await app.resume(first.thread, { approved: true, by: "dana" });
}
const next = await app.run(ChatWorkflowStart, { text: "and the second" }, { thread: first.thread });

await app.close(); // onStop hooks, MCP servers, tracing
```

## `app.run(Start, input, { thread?, signal? })`

- `Start` must be a `@WorkflowStart` of this workflow (else `NotAWorkflowStartError`); `input` is
  checked against its DTO before any call (`DtoValidationError`).
- `thread` continues a conversation; without it a new thread is created (its id is in the result).

## The result — `RunResult`

| Field                   | What it holds                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `thread`                | the conversation id — pass it to the next `run` or to `resume`                         |
| `finish`                | the name of the `@WorkflowFinish` the run reached (absent when paused or guarded)      |
| `output`                | the finish's data (`WorkflowFinishText`: `{ text }`)                                   |
| `pause`                 | what the run waits for — until #117 the tool call waiting for approval (`agent`, `tool`, `args`) |
| `path`                  | the flow nodes it visited, in order, as classes / named nodes (a paused run: up to the waiting agent) |
| `spend`                 | the `CostReport` of this run ([FinOps](FinOps))                                        |
| `status`, `answer`, `route`, `stopReason`, `compacted`, `traceUrl` | what the CLI prints |

A run that fails (a limit, a router, an agent) throws; the Tern and the spend are recorded first.

## `app.resume(thread, decision)`

Continues the paused run of the thread with a `ToolCallApprovalDecision` (`approved`, `by`,
`reason?` — [Pause seam](Pause-seam)); same result shape. A thread without a paused run →
`NotPausedError`. After the decision the agent answers and the turn ends without another router call
(#100).

## `app.close()`

Runs `onStop` of the components (dependants first; every hook runs, failures are reported together),
closes MCP connections and tracing, and the stores the app opened. Calling it twice is fine.

## Lifecycle hooks

A component the container creates (an `@Injectable` service, a tool, a knowledge base) may implement
`OnStart` / `OnStop` (`graphcompose`):

```ts
@Injectable()
export class Boards implements OnStart, OnStop {
  async onStart(): Promise<void> { /* open a pool */ }
  async onStop(): Promise<void> { /* close it */ }
}
```

`onStart` runs when the app is built (dependencies first), `onStop` when it closes. Values
(`{ provide, useValue }`) and test mocks have no hooks.

## Options — every part replaceable

`createApp(Workflow, options)` and `createAppDeps(bundle, options)` take the same parts; anything not
given is the production default:

| Option          | Default                                                   |
| --------------- | --------------------------------------------------------- |
| `env`           | `process.env`                                             |
| `gateway`       | OpenRouter (chat models + Jev) — the one model-call seam |
| `transport`     | MCP stdio / streamable HTTP from the server's config      |
| `connectMcp`    | connect every server, check its contract (fail fast)      |
| `stores`        | `checkpointer` (memory), `ledger` (files, `SPEND_LEDGER_DIR`), `terns` (SQLite, `TERN_DB`) — given stores stay open on `close` |
| `clock`         | the system clock (the ledger's UTC day, Tern times)       |
| `newThreadId`, `newRunId` | random UUIDs                                    |
| `container`     | `overrides` (values instead of classes — test mocks), `onCreate` |
| `pausedRuns`    | in memory, this app only                                  |
| `profile`, `profileRoot` | none ([Profiles and comparisons](Profiles-and-comparisons)) |

`graphcompose/testing` builds its apps with these: a scripted gateway, stubbed MCP servers, memory
stores, a test clock, deterministic ids.

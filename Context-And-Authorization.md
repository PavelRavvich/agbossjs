# Context and Authorization

A run has two kinds of data: the **state** it works on (persisted by the checkpointer, it survives
steps, pauses and the next run of the thread) and the **context of the call** that started it — who
asked, their session, a trace id. The context is never persisted to the graph's state; it reaches
tools and actions in memory.

## The run: `ctx.run`

Every tool and action gets its run as `ctx.run` (`RunContext`), built once per `execute` / `resume`:

| Field      | What                                                                     |
| ---------- | ------------------------------------------------------------------------ |
| `runId`    | unique per run, the same after a resume                                  |
| `threadId` | the conversation (`ExecutionOutput.thread`)                              |
| `signal`   | aborted by `app.cancel(thread)` or the caller's `signal`                 |
| `metadata` | from `execute(…, { metadata })` — strings, kept by the run's resumes     |
| `owner`    | from `execute(…, { owner })`: who the thread belongs to                  |

A thread created with an `owner` belongs to it: `execute` on that thread, `resume` and `cancel` with
another owner (or none) throw `ThreadOwnerError` (`run.thread-owner`) before anything runs or is
read.

## Your own call context: `executionContext`

Anything else the caller knows — a session, a role — is passed as `executionContext` and read, typed,
by actions (`ActionContext<T>`) and tools (`ToolContext<T>`).

```ts file=context.ts
export interface CallContext {
  readonly userId: string;
  readonly role: "admin" | "user";
}
```

### In an action

```ts
import { WorkflowAction, type ActionContext } from "agboss";
import type { CallContext } from "./context.js";

@WorkflowAction({ name: "process-data", description: "Processes the confidential data" })
export class ProcessDataAction {
  execute(_state: unknown, ctx: ActionContext<CallContext>) {
    if (ctx.executionContext?.role !== "admin")
      throw new Error(`Unauthorized: ${ctx.executionContext?.userId ?? "anonymous"} is not an admin`);
    console.log(`run ${ctx.run.runId}, request ${ctx.run.metadata.requestId ?? "-"}`);
    return {};
  }
}
```

### In a tool

```ts
import { Tool, type ToolContext, type ToolHandler } from "agboss";
import { Text } from "agboss/dto";
import type { CallContext } from "./context.js";

export class SecureQuery {
  @Text({ prompt: "what to look up" }) query!: string;
}
export class SecureData {
  @Text() text!: string;
}

@Tool({
  name: "secure_data",
  description: "Retrieves sensitive data; admins only",
  input: SecureQuery,
  output: SecureData,
})
export class SecureDataTool implements ToolHandler<SecureQuery, SecureData> {
  run({ query }: SecureQuery, ctx: ToolContext): Promise<SecureData> {
    const caller = ctx.executionContext as CallContext | undefined;
    if (caller?.role !== "admin") return Promise.resolve({ text: "Access denied." });
    return Promise.resolve({ text: `results for ${query} (call ${ctx.callId})` });
  }
}
```

A tool error or a denied call reaches the model as the call's result; the loop continues
([Agents](Agents)).

### Passing it in

<!-- snippet-context
import type { App, WorkflowStartClass } from "agboss";
import type { CallContext } from "./context.js";
declare const app: App;
declare const StartNode: WorkflowStartClass;
-->

```ts
const context: CallContext = { userId: "usr_123", role: "admin" }; // from the session / JWT

const result = await app.execute(
  StartNode,
  { text: "Process my confidential data" },
  {
    owner: context.userId, // the thread belongs to this user
    metadata: { requestId: "req_abc789" }, // kept by the run, visible as ctx.run.metadata
    executionContext: context, // in memory only, as ctx.executionContext
  },
);
```

Tool arguments a channel shows (and `ExecutionOutput.pause.args`) have the input DTO's `sensitive`
fields masked as `***`; the tool itself still gets them whole. In unit tests, `testRunContext()` from
`agboss/testing` builds a `ctx.run`.

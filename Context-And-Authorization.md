# Context and Authorization

A run has two kinds of data: the **state** it works on (persisted by the checkpointer, it survives
steps, pauses and the next run of the thread) and the **context of the call** that started it — who
asked, their session, a trace id. The context is never persisted to the graph's state; it reaches
tools in memory. Actions get only their input fields until #280's `ExecutionContext` (#272 S16).

## The run: `ctx.run`

Every tool gets its run as `ctx.run` (`RunContext`), built once per `execute` / `resume`:

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

Anything else the caller knows — a session, a role — is passed as `executionContext` and read by
tools (`ToolContext`). Authorization therefore sits in a tool (or a service it calls), not in an
action.

```ts file=context.ts
export interface CallContext {
  readonly userId: string;
  readonly role: "admin" | "user";
}
```

### In a tool

```ts file=secure-data.tool.ts
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

<!--
```ts file=data.workflow.ts
import { Agent, Workflow, WorkflowFinish, WorkflowStart, start } from "agboss";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "agboss/dto";
import { SecureDataTool } from "./secure-data.tool.js";
@WorkflowStart({ name: "data-workflow-start", description: "A request", input: WorkflowStartTextDto })
export class DataWorkflowStart {}
@WorkflowFinish({ name: "data-workflow-finish", description: "The answer", output: WorkflowFinishTextDto })
export class DataWorkflowFinish {}
@Agent({ name: "data-agent", description: "Looks data up", prompt: "Look it up.", model: "moonshotai/kimi-k2.6", tools: [SecureDataTool] })
export class DataAgent {}
@Workflow({ name: "data-workflow", version: "1.0.0", flow: [start(DataWorkflowStart).returns(WorkflowStartTextDto).toAgent(DataAgent).toFinish(DataWorkflowFinish)] })
export class DataWorkflow {}
```
-->

### Passing it in

<!-- snippet-context
import type { App } from "agboss";
import type { CallContext } from "./context.js";
import { DataWorkflowStart } from "./data.workflow.js";
declare const app: App;
-->

```ts
const context: CallContext = { userId: "usr_123", role: "admin" }; // from the session / JWT

const result = await app.execute(
  DataWorkflowStart,
  { text: "Process my confidential data" },
  {
    owner: context.userId, // the thread belongs to this user
    metadata: { requestId: "req_abc789" }, // kept by the run, visible as ctx.run.metadata
    executionContext: context, // in memory only, as a tool's ctx.executionContext
  },
);
```

Tool arguments a channel shows (and `ExecutionOutput.pause.args`) have the input DTO's `sensitive`
fields masked as `***`; the tool itself still gets them whole. In unit tests, `testRunContext()` from
`agboss/testing` builds a `ctx.run`.

# Tools

A tool is a `@Tool` class in its workflow's `tools/` folder — see [Components](Components) for the
pattern (constructor dependencies, `ToolHandler`, tests with `new`).

```ts
export class IssueQuery {
  @Text({ prompt: "words to search the issues for" })
  query!: string;
}

export class IssueList {
  @ListOf(Issue)
  issues!: Issue[];
}

@Tool({
  name: "search_issues",
  description: "Search the team's issues",
  input: IssueQuery,
  output: IssueList,
  deps: [ISSUES_API],
})
export class SearchIssues implements ToolHandler<IssueQuery, IssueList> {
  constructor(private readonly api: IssuesApi) {}
  run({ query }: IssueQuery, ctx: ToolContext): Promise<IssueList> {
    return this.api.search(query, ctx.signal);
  }
}
```

Input and output are DTO classes ([Components → DTOs](Components#dtos)); the model sees the input DTO's
JSON Schema, with each field's `prompt` as its description.

## Contract

| Step of `tool.invoke(raw, ctx)`                    | On failure                                                    |
| -------------------------------------------------- | ------------------------------------------------------------- |
| input validated against the input DTO             | `error: invalid input: <path>: <issue>` (`jobs[2].url`) — `run` is not called |
| run is not started if the run is already cancelled | `error: <abort reason>`                                       |
| `run` under a timeout and the run's `AbortSignal`  | `error: timed out after N ms` / `error: <message>`            |
| output validated against the output DTO           | `error: invalid output: …` — a contract bug of the tool       |

Results are values — `ToolResult = { kind: "ok", value } | { kind: "error", message }` — never
exceptions: the model sees `Tool error: …` and can recover.

`ToolContext` gives a tool `runId`, `workflow`, `agent`, `signal` and `reportCost(usd)` for paid tools.

## Library and workflow tools

A tool lives in its workflow's `tools/` folder (the framework ships none). There is no central
registry: an agent's `tools: [SearchIssues]` **is** the registration.

## MCP

A server declares the tools it offers that the workflow uses (`@McpServer({ tools })`, `extends McpServerClient`);
an `@McpTool` is a tool with that server injected, calling it in `run` — see
[Components → MCP](Components#mcp). Env variable NAMES only in the config, never secrets.
A server tool that answers with plain text declares `output: PlainText` (`graphcompose/dto`, the one
field `text`) — the server's text arrives as `{ text }`; `gc g mcp` writes that by default.

## Agents with tools

```ts
// agents/scout.agent.ts — the workflow sets defaults.tools.maxToolCalls; an agent may override it
@Agent({ name: "scout", model: "moonshotai/kimi-k2.6", tools: [GreenhouseJobs], maxToolCalls: 4, … })
export class Scout {}
```

- `tools` lists classes — a missing or not-imported tool does not compile; at startup names are
  re-checked against the registry (`UnknownAgentToolError`).
- The agent runs the framework's own loop ([Agents](Agents)): usage recorded per model call, the
  run budget checked before each call (spent → `stopped: run budget exhausted`, then the run fails
  at `limits.perRun.cost`), `maxToolCalls` → `agents.<name>.limits.toolCalls` (default 20) **fails
  the run** with `LimitExceededError`; the loop's spend still reaches the daily ledger.
- Each call runs as its own task with the run's signal and the tool's `timeoutMs`; parallel calls
  of one turn run concurrently.
- `ctx.callId` is the call's id — the same when a call interrupted by a crash runs again. Tools with
  side effects **must** use it as their idempotency key.
- Tool errors do not fail the run: the model reads `Tool error: …` and continues.

## For the model

`toolDefinitionOf(tool)` describes a tool to the agent's chat model (`bindTools`): name, description
and the JSON Schema of the input; validation, timeout and error mapping stay in `invoke`.

## Isolation and tests

`src/tools` imports only `config`, `finops`, `llm`; the rest of the code imports it only through
`src/tools/index.ts` (ESLint). `npm run test:tools` runs tool tests alone, without network.

Decisions: [ADR-0003](ADR-0003-Typed-tools-and-MCP-facades).

## Who can use which tool

An agent's `tools` lists **class references**, so a missing or not-imported tool is a compile error.
To see it all at once — no API key or network needed:

```bash
npm run describe
```

```
  notes  moonshotai/kimi-k2.6 · thinking default · history 5 turns + 10 summaries
    · note_search (read, local) ← NOTES_FILE — Find the user's saved notes …
    · note_save (write, local, waits for approval) ← NOTES_FILE — Save a note for the user.
unassigned tools: none
```


## Testing

Tools are tested using SpringBoot-like DI mocking provided by the `graphcompose` testing toolkit. You can mock a tool's execution method to return specific mocked responses, preventing actual execution.

```ts
import { mockOf } from "graphcompose/testing";
import { MyTool } from "./my-tool";

// Mock the DI-injected tool's execution to resolve a specific value
mockOf(MyTool).execute.mockResolvedValue({ status: "success" });

// After running your workflow, you can assert on the mock
expect(mockOf(MyTool).execute).toHaveBeenCalledWith(expectedArgs);
```


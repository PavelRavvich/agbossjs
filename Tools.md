# Tools

A tool is a `@Tool` class in its bundle's `tools/` folder — see [Components](Components) for the
pattern (constructor dependencies, `ToolHandler`, tests with `new`).

```ts
const In = z.object({ query: z.string() });
const Out = z.array(Issue);

@Tool({
  name: "search_issues",
  description: "Search the team's issues",
  input: In,
  output: Out,
  deps: [ISSUES_API],
})
export class SearchIssues implements ToolHandler<typeof In, typeof Out> {
  constructor(private readonly api: IssuesApi) {}
  run({ query }: z.output<typeof In>, ctx: ToolContext) {
    return this.api.search(query, ctx.signal);
  }
}
```

## Contract

| Step of `tool.invoke(raw, ctx)`                    | On failure                                                    |
| -------------------------------------------------- | ------------------------------------------------------------- |
| input parsed with zod                              | `error: invalid input: <path>: <issue>` — `run` is not called |
| run is not started if the run is already cancelled | `error: <abort reason>`                                       |
| `run` under a timeout and the run's `AbortSignal`  | `error: timed out after N ms` / `error: <message>`            |
| output parsed with zod                             | `error: invalid output: …` — a contract bug of the tool       |

Results are values — `ToolResult = { kind: "ok", value } | { kind: "error", message }` — never
exceptions: the model sees `Tool error: …` and can recover.

`ToolContext` gives a tool `runId`, `bundle`, `agent`, `signal` and `reportCost(usd)` for paid tools.

## Library and bundle tools

Reusable tools live in `src/tools/examples/` (e.g. `CurrentTime`) and are imported through
`src/tools/index.ts`; a bundle's own tools live in its `tools/` folder. There is no central
registry: an agent's `tools: [SearchIssues, CurrentTime]` **is** the registration.

## MCP servers — typed facades

```ts
// mcp/github.ts — env variable NAMES only, never secrets
@McpServer({
  name: "github",
  transport: "stdio",
  command: "github-mcp-server",
  args: ["stdio"],
  env: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
})
export class GitHub {}

@McpTool({
  server: GitHub,
  tool: "list_pull_requests",
  description: "Open pull requests of a repository",
  input: z.object({ owner: z.string(), repo: z.string() }),
  output: z.string(),
})
export class ListPullRequests {}
```

List the server in `@Bundle({ mcp })` and reference the facade from an agent's `tools`. A facade is
named `<server>__<tool>`. At startup every used server is connected and each facade's schema is
checked against the server's; a missing server, env variable or a drifted contract stops startup.

## Agents with tools

```ts
// agents.config.ts
defaults: { tools: { maxToolCalls: 8 }, … },
agents: {
  researcher: { model: "moonshotai/kimi-k2.6", tools: ["current_time"], maxToolCalls: 4, … },
}
```

- `tools` is typed by `ToolName` — a name outside the registry does not compile; at startup names are
  re-checked against the registry (`UnknownAgentToolError`).
- The agent runs a model ↔ tool loop (`createAgent`, `langchain` v1) with its own model, prompt,
  thinking and cache settings. Middleware around every model call:
  - **usage** — every call of the loop is a `UsageRecord`;
  - **budget** — spent run budget → the loop stops without calling the model, the agent's answer is
    `stopped: run budget exhausted`, and the router finishes the run (`budget exhausted`);
  - **tool call limit** — crossing `maxToolCalls` **fails the run** (`AgentFailedError`, cause
    `ToolCallLimitExceededError`); the loop's spend still reaches the daily ledger.
- Tool errors do not fail the run: the model reads `Tool error: …` and continues.

## For LangChain

`toLangChainTool(tool, ctx)` exposes a tool to agents: the model sees the JSON Schema of the input;
validation, timeout and error mapping stay in `invoke`.

## Isolation and tests

`src/tools` imports only `config`, `finops`, `llm`; the rest of the code imports it only through
`src/tools/index.ts` (ESLint). `npm run test:tools` runs tool tests alone, without network.

Decisions: [ADR-0003](ADR-0003-Typed-tools-and-MCP-facades).

## Who can use which tool

An agent's `tools` lists **class references**, so a missing or not-imported tool is a compile error.
To see it all at once — no API key or network needed:

```bash
npm run describe -- --config company-assistant-approval
```

```
  notes  moonshotai/kimi-k2.6 · thinking default · history 5 turns + 10 summaries
    · note_search (read, local) ← NOTES_FILE — Find the user's saved notes …
    · note_save (write, local, waits for approval) ← NOTES_FILE — Save a note for the user.
unassigned tools: none
```

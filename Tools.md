# Tools

One typed shape for every tool agents can call — own functions and MCP facades.

```ts
const searchIssues = defineTool({
  name: "github_search_issues",            // ^[a-zA-Z0-9_-]{1,64}$
  description: "Search issues in a repository",
  input: z.object({ repo: z.string(), query: z.string(), limit: z.number().max(50).default(10) }),
  output: z.array(z.object({ number: z.number(), title: z.string() })),
  effect: "read",                          // "write" = changes the outside world
  timeoutMs: 30_000,                       // default
  run: async ({ repo, query, limit }, ctx) => …,   // types inferred from the schemas
});
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

## Registry

`src/tools/catalog.ts` lists every tool of the project:

```ts
export const toolRegistry = createToolRegistry([
  createCurrentTimeTool(),
  searchIssues,
]);
export type ToolName = ToolNameOf<typeof toolRegistry>; // "current_time" | "github_search_issues"
```

Duplicate names fail at startup; `ToolName` is the union agents' config will be checked against.
Example tool: `current_time` (`src/tools/examples/current-time.ts`).

## MCP servers — typed facades

Agents see only MCP tools we declared with zod schemas; a facade is the same `Tool<Name, Input, Output>`.

```ts
// src/tools/catalog.ts
const github = mcpServer("github");
const listPullRequests = github.tool({
  tool: "list_pull_requests", // name on the server
  description: "Open pull requests of a repository",
  input: z.object({ owner: z.string(), repo: z.string() }),
  output: z.string(), // required; z.string() = text only the model reads
});
export const mcpServerHandles = [github];
export const toolRegistry = createToolRegistry([
  createCurrentTimeTool(),
  listPullRequests,
]);
// agents see it as "github__list_pull_requests"
```

```ts
// agents.config.ts — env variable NAMES only, never secrets
mcpServers: {
  github: { transport: "stdio", command: "github-mcp-server", args: ["stdio"], env: ["GITHUB_PERSONAL_ACCESS_TOKEN"] },
  // docs: { transport: "http", url: "https://…/mcp", headers: { Authorization: "DOCS_TOKEN" } },
}
```

**Startup (fail fast)** — `createAppDeps()` connects every server used by a facade and stops with:

| Error                 | When                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `McpUnavailableError` | server not in `mcpServers`, env variable missing, connection or `listTools` failed        |
| `McpContractError`    | tool missing on the server; input (and output, if the server declares one) not compatible |

Compatibility, not equality: every property the server requires is declared in the facade, every
facade property exists on the server, shared properties have the same JSON type.

**Results**: `structuredContent` if present, otherwise text — parsed as JSON unless the output schema is
`z.string()` — then validated; `isError` becomes an error result with the server's text.

Implementation: official `@modelcontextprotocol/sdk`, not `@langchain/mcp-adapters` (it would add an
untyped layer under typed facades). Tests use an in-memory MCP server — no process, no network.

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

# Tools

One typed shape for every tool agents can call — own functions and (next) MCP facades.

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

## For LangChain

`toLangChainTool(tool, ctx)` exposes a tool to agents: the model sees the JSON Schema of the input;
validation, timeout and error mapping stay in `invoke`.

## Isolation and tests

`src/tools` imports only `config`, `finops`, `llm`; the rest of the code imports it only through
`src/tools/index.ts` (ESLint). `npm run test:tools` runs tool tests alone, without network.

Decisions: [ADR-0003](ADR-0003-Typed-tools-and-MCP-facades).

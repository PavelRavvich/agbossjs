# Components

A workflow (a set of agents) is built from **annotated classes**, one per file, in folders by kind —
Angular style. Decorators carry settings; behaviour is an interface the class implements (like
`implements OnInit`); dependencies come through the **constructor**. The compiler checks every link.
Decision: [ADR-0009](ADR-0009-Angular-style-components-with-constructor-injection).

```
examples/job-scout/src/              (a workflow — related agents under one directory)
  agents/  researcher.ts  researcher.prompt.md  coder.ts  coder.prompt.md
  tools/   …                          @Tool classes
  mcp/     …                          @McpServer + @McpTool facades
  job-scout.workflow.ts                @Workflow — the module
```

The example `examples/job-scout` uses every kind below — see [Example](Example).

## File conventions

One component per file, the kind in the name (Angular style); `gc create` / `gc g` follow them:

| File                                           | Holds                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `<name>.workflow.ts`                           | the `@Workflow` module                                                                                                   |
| `agents/<name>.agent.ts` + `<name>.prompt.md`  | an `@Agent`; its prompt **by convention** next to it (like `templateUrl`) — `prompt: "./other.md"` only for another file |
| `tools/<name>.tool.ts` + `<name>.tool.test.ts` | a `@Tool` and its test                                                                                                   |
| `mcp/<name>.mcp.ts`                            | an `@McpServer` and its `@McpTool` facades                                                                               |
| `rag/<name>.rag.ts`                            | a `@Rag` knowledge base                                                                                                  |
| `services/<name>.service.ts`                   | an `@Injectable` (like an Angular service)                                                                               |
| `helpers/<name>.helper.ts`                     | plain functions                                                                                                          |

A tool class keeps `run` and short methods that belong to it; anything bulky or reusable goes to a
`*.helper.ts`. The prompt file is found from the file the `@Agent` is declared in (read at runtime
through the V8 CallSite API — a decorator cannot know its module otherwise): keep the `.md` next to the
agent's module; a missing one is `@Agent "<name>": prompt file not found: <path>`.

## A tool

```ts
@Tool({ name: "greenhouse_jobs", effect: "read", description: "…", input: SearchInput, output: SearchOutput,
        deps: [JobFitJudge, JOB_SEARCH] })
export class GreenhouseJobs implements ToolHandler<typeof SearchInput, typeof SearchOutput> {
  constructor(private readonly judge: FitRater, private readonly search: JobSearch) {}
  async run(input: z.output<typeof SearchInput>, ctx: ToolContext) { … }   // typed from the schemas
}
```

- `run` is checked against the zod schemas; the core validates input and output, applies the timeout
  and returns errors to the model.
- `deps` lists the constructor's dependencies **in order** — a missing, extra or reordered entry is a
  compile error (standard decorators have no parameter-type metadata, so they are listed once).
- Test with plain `new` and fakes: `toolOf(new GreenhouseJobs(fakeJudge, search))` — no container.

## An agent

```ts
@Agent({
  name: "scout",
  description: "…",
  model: KIMI,
  price: KIMI_PRICE,
  thinking: "none",
  tools: [GreenhouseJobs],
})
export class Scout {}
```

Settings are the `agents.<name>` fields of [Configuration](Configuration) (`reasoning`, `historyLimit`, …).
The prompt is a Markdown file next to the agent; `{{name}}` in it is filled from
`@Workflow({ promptVariables })` (an unknown one fails assembly).

## MCP

```ts
@McpServer({ name: "docs", transport: "stdio", command: FILESYSTEM_SERVER, args: [DOCS_DIR] })
export class DocsServer {}

@McpTool({ server: DocsServer, tool: "read_text_file", description: "…", input: …, output: … })
export class ReadDoc {}          // agents reference it like any tool: tools: [ReadDoc]
```

## A knowledge base

`@Rag` classes in `rag/`, bound by agents with a required mode — see [Knowledge bases](Knowledge-bases).

## The module

```ts
@Workflow({
  name: "job-scout",
  version: "1.1.0",
  defaults,
  budget,
  routers,
  guards,
  compaction,
  agents: [Profiler, Scout],
  mcp: [],
  promptVariables,
  providers: [JobFitJudge, { provide: JOB_SEARCH, useValue: jobSearchConfig }],
})
export class JobScout {}
```

- `providers` registers what components inject: classes (`@Injectable({ deps })`, created by the
  container) and values (`InjectionToken<T>` + `useValue`). The core provides `ROUTER_FACTORY` (Jev
  routers for cheap decisions inside tools) and `ENV`.
- **Assembly** (`workflowOf`, at startup, before the first request): the dependency graph is checked and
  every instance is created **once, dependencies first**. A cycle, an unregistered provider, a class
  in `tools` that is not a component, a missing prompt file or prompt variable fail with the
  component's name.
- The assembled workflow is the same config the core always ran: [profiles](Profiles-and-comparisons),
  `describe`, Studio and tracing work unchanged. `npm run describe` shows each tool's dependencies:
  `greenhouse_jobs (read, local) ← JobFitJudge (ROUTER_FACTORY), JOB_SEARCH`.

## Add…

- **a tool** — one `@Tool` class in the workflow's `tools/`, then reference it from an agent's `tools`.
- **an agent** — `agents/<name>.ts` + `agents/<name>.prompt.md`, then list it in `@Workflow({ agents })`.
- **an MCP server** — `@McpServer` + `@McpTool` facades in `mcp/`, the server in `@Workflow({ mcp })`.
- **a workflow** — a folder with the above and a `*.workflow.ts`, registered in `src/workflows.ts`.

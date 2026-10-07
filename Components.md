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

## Component rules

Every component reads the same way, top to bottom:

1. **The decorator holds metadata** (name, description, input / output DTOs, `deps`) — one option per line.
2. **The constructor holds the dependencies** — `private readonly` parameters, one per line.
3. **The methods implement a contract**:
   - your own implementation → `implements` the contract (`ToolHandler<In, Out>` for `@Tool` / `@McpTool`,
     `RagConnector` for `@Rag`);
   - extending a standard implementation → `extends` it (`SqliteFtsConnector`, `McpServerClient`) and mark
     overridden methods `override` (`noImplicitOverride` is on — no `override`, no build).
4. **Data is a DTO**: a class with one field decorator per field (`graphcompose/dto`), so the class is
   both the type and the runtime check: `run(query: OrderQuery): Promise<OrderStatus>`. See [DTOs](#dtos).
5. **Input/output lives in services** (`@Injectable`, `*.service.ts`: HTTP, files, model calls);
   **helpers are pure** (`*.helper.ts`: parsing, filters, scores).

`@Workflow` and `@Agent` follow the same file and formatting rules; they carry metadata only.

## File conventions

One component per file, the kind in the name (Angular style); `gc create` / `gc g` follow them:

| File                                           | Holds                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `<name>.workflow.ts`                           | the `@Workflow` module                                                                                                   |
| `workflow-starts/<name>.workflow-start.ts`     | a `@WorkflowStart` — where a run starts ([Workflow](Workflow))                                                           |
| `routers/<name>.router.ts`                     | a `@Router` with its routes ([Routers](Routers))                                                                         |
| `workflow-finishes/<name>.workflow-finish.ts`  | a `@WorkflowFinish` — where a run finishes                                                                               |
| `agents/<name>.agent.ts`  | an `@Agent`; explicit `instructions: file("./<name>.prompt.md")` |
| `tools/<name>.tool.ts` + `<name>.tool.test.ts` | a `@Tool` and its test                                                                                                   |
| `tools/<name>.dto.ts`, `mcp/<name>.dto.ts`     | the DTOs of the tools / server next to it (plain data classes)                                                           |
| `mcp/<name>.server.ts`                         | an `@McpServer` and the server tools it uses (`extends McpServerClient`)                                                 |
| `mcp/<name>.mcp.ts`                            | an `@McpTool` — a tool with its server injected                                                                          |
| `rag/<name>.rag.ts`                            | a `@Rag` knowledge base                                                                                                  |
| `services/<name>.service.ts`                   | an `@Injectable` (like an Angular service)                                                                               |
| `helpers/<name>.helper.ts`                     | plain functions                                                                                                          |

A tool class keeps `run` and short methods that belong to it; anything bulky or reusable goes to a
`*.helper.ts`. The `instructions` file is explicitly passed via the `file()` helper. (read at runtime
through the V8 CallSite API — a decorator cannot know its module otherwise): keep the `.md` next to the
agent's module; a missing one is `@Agent "<name>": prompt file not found: <path>`.

## A tool

```ts
// tools/search-orders.dto.ts
export class OrderQuery {
  @Text({ prompt: "the order id, e.g. A-1042" })
  orderId!: string;
}

export class OrderStatus {
  @OneOf({ values: ["placed", "shipped", "delivered"] })
  status!: "placed" | "shipped" | "delivered";

  @Date({ prompt: "expected delivery day" })
  eta!: string;
}

// tools/search-orders.tool.ts
@Tool({
  name: "search_orders",
  description: "Find an order's status by its id",
  input: OrderQuery,
  output: OrderStatus,
  deps: [OrdersService],
})
export class SearchOrders implements ToolHandler<OrderQuery, OrderStatus> {
  constructor(private readonly orders: OrdersService) {}

  run(query: OrderQuery): Promise<OrderStatus> {
    return this.orders.find(query.orderId);
  }
}
```

- `run` is checked against the decorator's DTOs (a mismatch is a compile error); the core validates input and output, applies the timeout
  and returns errors to the model (`invalid input: jobs[2].url: …`).
- `deps` lists the constructor's dependencies **in order** — a missing, extra or reordered entry is a
  compile error (standard decorators have no parameter-type metadata, so they are listed once).
- Test with plain `new` and fakes: `toolOf(new SearchOrders(fakeOrders))` — no container.

## DTOs

Data shapes — tool inputs and outputs, server tools — are **classes with one field decorator per field**,
imported from `graphcompose/dto`. zod stays inside the framework. Decision:
[ADR-0013](ADR-0013-DTO-classes-instead-of-zod); ready-made ones: [Standard DTOs](Standard-DTOs).

```ts
import { Integer, ListOf, OneOf, Text } from "graphcompose/dto";

export class JobQuery {
  @Text({ prompt: "what the user wants", minLength: 20 })
  profile!: string;

  @ListOf(Text, { prompt: "places or cities", minItems: 1 })
  locations!: string[];

  @Integer({ prompt: "how many jobs", min: 1, max: 50, default: 20 })
  count!: number;

  @OneOf({ values: ["remote", "office"], optional: true })
  mode?: "remote" | "office";
}
```

| Decorator                                                          | Field type   | Checked at runtime                                       |
| ------------------------------------------------------------------ | ------------ | -------------------------------------------------------- |
| `@Text({ minLength?, maxLength?, pattern? })`                      | `string`     | length; `pattern` — your own format (say it in `prompt`) |
| `@Integer({ min?, max? })` / `@Decimal({ min?, max? })`            | `number`     | whole / finite number, range                             |
| `@Flag()`                                                          | `boolean`    | —                                                        |
| `@Email()`, `@Url()`, `@Uuid()`                                    | `string`     | format                                                   |
| `@Date()` / `@DateTime()` / `@Duration()`                          | `string`     | ISO 8601; a date-time **needs an offset or `Z`**         |
| `@DecimalString({ scale? })`                                       | `string`     | `"19.99"`, at most `scale` digits after the point        |
| `@CurrencyCode()` / `@CountryCode()`                               | `string`     | ISO 4217 (`USD`) / ISO 3166-1 alpha-2 (`IL`), from lists |
| `@PhoneNumber()` / `@MediaType()` / `@TimeZone()`                  | `string`     | E.164 / `type/subtype` / IANA zone (or `UTC`)            |
| `@OneOf({ values })`                                               | their union  | one of the values                                        |
| `@ListOf(Dto or Text…, { minItems?, maxItems? })` / `@Nested(Dto)` | `T[]` / `T`  | each element / the nested DTO                            |

Every decorator takes `prompt` (what the model reads — the field's JSON Schema `description`),
`optional`, `sensitive`, `example` (→ `examples`) and `default`.

- **The compiler checks**: the decorator fits the field's type (`@Text` on a `number`), `optional: true`
  ↔ `name?:` both ways, `@OneOf` values ≡ the field's union, the element type of `@ListOf` / `@Nested`,
  and that the field is public, not `#private`, not `static`.
- **At runtime** (a validation error with the field path and the reason): integer vs decimal, formats,
  lengths, ranges, list sizes, code lists, cross-field rules of the standard DTOs. `@DateTime` without an
  offset → `dto.date-time-without-offset`.
- **At startup** (`workflowOf`, the first use): a field without a decorator → `dto.undecorated-field`;
  methods, accessors or `#private` fields → `dto.not-plain-data`. A DTO is plain data so object literals
  fit it (`{ path: "a.md" }` is a `FileRead`).
- **Not checkable**: two DTOs with the same fields are interchangeable to the compiler (structural typing).
- **Field order** is the declaration order — the order the model reads and fills the fields in.
- **Names**: input and output are a pair from one noun — `FileRead` → `FileContent`, `FileWrite` →
  `FileWritten`, `JobQuery` → `JobMatches`.
- A tool that takes nothing: `input: NoInput`. A server tool that answers with plain text:
  `output: PlainText` (any DTO of the one field `text`) — the text arrives as `{ text }`.
- `graphcompose` sets `Symbol.metadata` when imported (Node has none yet), so DTOs work under `tsc`,
  `tsx` and Vitest alike; DTO projects need `target` ES2022+ (class fields are defined).

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

Settings are the `agents.<name>` fields of [Configuration](Configuration) (`maxToolCalls`, `historyLimit`, …).
The prompt is often a Markdown file loaded by `file(...)`. It can also be a runtime-evaluated string.

## MCP

A server declares the tools of it the workflow uses; an MCP tool is a tool with the server injected:

```ts
// mcp/shortlist.server.ts
const tools = {
  read_text_file: { input: FileRead, output: FileContent },   // DTO classes from mcp/shortlist.dto.ts
  write_file: { input: FileWrite, output: FileWritten },
};

@McpServer({
  name: "shortlist",
  transport: "stdio",
  command: process.execPath,
  args: [FILESYSTEM_SERVER, SHORTLIST_DIR],
  tools,
})
export class ShortlistServer extends McpServerClient<typeof tools> {}

// mcp/save-shortlist.mcp.ts
@McpTool({
  server: ShortlistServer,
  name: "save_shortlist",
  description: "Save the jobs the user chose to their shortlist",
  effect: "write",
  input: ChosenJobs,
  output: SavedJobs,
  deps: [ShortlistServer, SHORTLIST],
})
export class SaveShortlist implements ToolHandler<ChosenJobs, SavedJobs> {
  constructor(
    private readonly server: ShortlistServer,
    private readonly file: string,
  ) {}

  async run({ jobs }: ChosenJobs): Promise<SavedJobs> {
    const current = await this.server.call("read_text_file", { path: this.file });   // typed by `tools`
    …
  }
}
```

- `server.call(name, args)` — the name and arguments are checked by the compiler (by the DTOs' fields),
  validated and parsed by the declared DTOs.
- At startup every declared server tool must exist on the server with a compatible input schema, or the
  app stops naming it.
- Test without a process: `new SaveShortlist(mcpServerStub(ShortlistServer, { write_file: async (args) => … }), file)`.

## A knowledge base

`@Rag` classes in `rag/`, bound by agents with a required mode — see [Knowledge bases](Knowledge-bases).

## The module

```ts
@Workflow({
  name: "job-scout",
  version: "2.0.0",
  flow: [
    from(ChatWorkflowStart).next(MainRouter),
    from(MainRouter).routeOne(Profiler, Scout, Shortlist, ChatWorkflowFinish),
    from(Profiler, Scout, Shortlist).next(MainRouter),
  ],
  defaults,
  guards,
  compaction,
  mcp: [ShortlistServer],
  promptVariables,
  providers: [JobFitJudge, { provide: JOB_SEARCH, useValue: jobSearchConfig }],
})
export class JobScout implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder()
      .limits({ perRun: { steps: 12, cost: usd(0.1) }, perDay: { cost: usd(1) } })
      .build();
  }
}
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
- **an agent** — `agents/<name>.ts` with `instructions: file(...)`, then list it in `@Workflow({ agents })`.
- **an MCP server** — `@McpServer` + `@McpTool` facades in `mcp/`, the server in `@Workflow({ mcp })`.
- **a workflow** — a folder with the above and a `*.workflow.ts`, registered in `src/workflows.ts`.

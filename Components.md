# Components

A workflow is built from **annotated classes**, one per file, in folders by kind — Angular style.
Decorators carry metadata; behaviour is a contract the class implements (like `implements OnInit`);
dependencies come through the **constructor**. The compiler checks every link. Decision:
[ADR-0009](ADR-0009-Angular-style-components-with-constructor-injection). Every block on this page
compiles against the current package.

```
examples/job-scout/src/
  job-scout.workflow.ts            @Workflow — the module (flow, defaults, providers; limits in settings())
  workflow-starts/  routers/  agents/  workflow-finishes/
  tools/  services/  mcp/  rag/  helpers/  environments/
```

The example `examples/job-scout` uses every kind below — see [Example](Example).

## Component rules

Every component reads the same way, top to bottom:

1. **The decorator holds metadata** (name, description, input / output DTOs, `deps`).
2. **The constructor holds the dependencies** — `private readonly` parameters.
3. **The methods implement a contract**:
   - your own implementation → `implements` the contract (`ToolHandler<In, Out>` for `@Tool` /
     `@McpTool`, `RagConnector` for `@Rag`, `JudgeHandler` for `@Judge`);
   - extending a standard implementation → `extends` it (`SqliteFtsConnector`, `McpServerClient`) and
     mark overridden methods `override` (`noImplicitOverride` is on).
4. **Data is a DTO**: a class with one field decorator per field (`agboss/dto`), so the class is
   both the type and the runtime check. See [DTOs](#dtos).
5. **Input/output lives in services** (`@Injectable`, `*.service.ts`: HTTP, files, model calls);
   **helpers are pure** (`*.helper.ts`: parsing, filters, scores).

## File conventions

One component per file, the kind in the name; `agboss create` / `agboss generate` follow them:

| File                                           | Holds                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| `<name>.workflow.ts`                           | the `@Workflow` module                                                   |
| `workflow-starts/<name>.workflow-start.ts`     | a `@WorkflowStart` — where a run starts ([Workflow](Workflow))           |
| `routers/<name>.router.ts`                     | a `@Router` with its routes ([Routers](Routers))                         |
| `workflow-finishes/<name>.workflow-finish.ts`  | a `@WorkflowFinish` — where a run finishes                               |
| `agents/<name>.agent.ts` + `<name>.prompt.md`  | an `@Agent`; its prompt file in `promptUrls: ["./<name>.prompt.md"]`     |
| `tools/<name>.tool.ts` + `<name>.tool.test.ts` | a `@Tool` and its test                                                   |
| `tools/<name>.dto.ts`, `mcp/<name>.dto.ts`     | the DTOs of the tools / server next to it (plain data classes)           |
| `mcp/<name>.server.ts`                         | an `@McpServer` and the server tools it uses (`extends McpServerClient`) |
| `mcp/<name>.mcp.ts`                            | an `@McpTool` — a tool with its server injected                          |
| `rag/<name>.rag.ts`                            | a `@Rag` knowledge base                                                  |
| `services/<name>.service.ts`                   | an `@Injectable` (like an Angular service)                               |
| `helpers/<name>.helper.ts`                     | plain functions                                                          |
| `environments/<name>.environment.ts`           | an environment's values ([Configuration](Configuration#environments))    |

Prompts are `prompt` (inline) or `promptUrls` (files next to the component, read relative to the
declaring module), plus `promptVariables`; `{{variables}}` are checked at assembly
(`[prompt.unknown-variable]`), a missing file fails with `[prompt.missing-file]`.

## A tool

```ts file=tools/search-orders.dto.ts
import { OneOf, Text } from "agboss/dto";

export class OrderQuery {
  @Text({ prompt: "the order id, e.g. A-1042" })
  orderId!: string;
}

export class OrderStatus {
  @OneOf({ values: ["placed", "shipped", "delivered"] })
  status!: "placed" | "shipped" | "delivered";

  @Text({ prompt: "expected delivery day, YYYY-MM-DD" })
  eta!: string;
}
```

```ts file=services/orders.service.ts
import { Injectable } from "agboss";
import type { OrderStatus } from "../tools/search-orders.dto.js";

@Injectable()
export class OrdersService {
  find(orderId: string): Promise<OrderStatus> {
    return Promise.resolve({ status: orderId.startsWith("A") ? "shipped" : "placed", eta: "2026-11-02" });
  }
}
```

```ts file=tools/search-orders.tool.ts
import { Tool, type ToolHandler } from "agboss";
import { OrdersService } from "../services/orders.service.js";
import { OrderQuery, OrderStatus } from "./search-orders.dto.js";

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

- `run` is checked against the decorator's DTOs (a mismatch is a compile error); the core validates
  input and output, applies `timeoutMs` and returns errors to the model (`invalid input: …`).
- `deps` lists the constructor's dependencies **in order** — a missing, extra or reordered entry is a
  compile error (standard decorators have no parameter-type metadata, so they are listed once).
- Test with plain `new` and fakes: `toolOf(new SearchOrders(fakeOrders))` — no container
  ([Tools](Tools)).

## DTOs

Data shapes — tool inputs and outputs, server tools, workflow start and finish — are **classes with
one field decorator per field**, imported from `agboss/dto`. zod stays inside the framework.
Decision: [ADR-0013](ADR-0013-DTO-classes-instead-of-zod); ready-made ones: [Standard DTOs](Standard-DTOs).

```ts
import { Integer, ListOf, OneOf, Text } from "agboss/dto";

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

| Decorator                                                          | Field type  | Checked at runtime                                       |
| ------------------------------------------------------------------ | ----------- | -------------------------------------------------------- |
| `@Text({ minLength?, maxLength?, pattern? })`                      | `string`    | length; `pattern` — your own format (say it in `prompt`) |
| `@Integer({ min?, max? })` / `@Decimal({ min?, max? })`            | `number`    | whole / finite number, range                             |
| `@Flag()`                                                          | `boolean`   | —                                                        |
| `@Email()`, `@Url()`, `@Uuid()`                                    | `string`    | format                                                   |
| `@DateTime()` / `@Duration()`                                      | `string`    | ISO 8601; a date-time **needs an offset or `Z`**         |
| `@DecimalString({ scale? })`                                       | `string`    | `"19.99"`, at most `scale` digits after the point        |
| `@CurrencyCode()` / `@CountryCode()`                               | `string`    | ISO 4217 (`USD`) / ISO 3166-1 alpha-2 (`IL`), from lists |
| `@PhoneNumber()` / `@MediaType()` / `@TimeZone()`                  | `string`    | E.164 / `type/subtype` / IANA zone (or `UTC`)            |
| `@OneOf({ values })`                                               | their union | one of the values                                        |
| `@ListOf(Dto or Text…, { minItems?, maxItems? })` / `@Nested(Dto)` | `T[]` / `T` | each element / the nested DTO                            |

Every decorator takes `prompt` (what the model reads — the field's JSON Schema `description`),
`optional: true` or a `default`, `sensitive` (masked as `***` wherever the arguments are shown) and
`example`.

- **The compiler checks**: the decorator fits the field's type (`@Text` on a `number`), `optional: true`
  ↔ `name?:` both ways, `@OneOf` values ≡ the field's union, the element type of `@ListOf` / `@Nested`.
- **At runtime** (a `DtoValidationError` with the field path and the reason): integer vs decimal,
  formats, lengths, ranges, list sizes, code lists, cross-field rules of the standard DTOs.
- **At startup**: a field without a decorator → `dto.undecorated-field`; methods, accessors or
  `#private` fields → `dto.not-plain-data`. A DTO is plain data, so object literals fit it.
- **Field order** is the declaration order — the order the model reads and fills the fields in.
- **Names**: input and output are a pair from one noun — `FileRead` → `FileContent`, `JobQuery` →
  `JobMatches`. A tool that takes nothing: `input: NoInput`.

## An agent

<!-- snippet-context
import { SearchOrders } from "./tools/search-orders.tool.js";
-->

```ts
import { Agent } from "agboss";

@Agent({
  name: "support",
  description: "Answers questions about orders", // what routers read
  promptUrls: ["./support.prompt.md"], // next to this file; or prompt: "…"
  model: "moonshotai/kimi-k2.6",
  thinking: "none",
  maxTokens: 2000,
  tools: [SearchOrders],
})
export class SupportAgent {}
```

The other options — `temperature`, `cache`, `maxToolCalls`, `historyLimit`, `historySummaries`,
`judges` + `maxRetries`, `rag`, `memoryStrategy`, `compensate`, guardrails and PII policies — are
on [Configuration](Configuration) and the pages of each feature. How the agent runs: [Agents](Agents).

## MCP

A server declares the server tools the workflow uses; an MCP tool is a tool with the server injected
(more: [Mcp](Mcp)):

```ts file=mcp/shortlist.dto.ts
import { ListOf, Text } from "agboss/dto";

export class FileRead {
  @Text({ prompt: "path inside the shortlist folder" }) path!: string;
}
export class FileContent {
  @Text({ prompt: "the file's text" }) content!: string;
}
export class FileWrite {
  @Text() path!: string;
  @Text() content!: string;
}
export class FileWritten {
  @Text() content!: string;
}
export class ChosenJobs {
  @ListOf(Text, { prompt: "links of the jobs the user chose", minItems: 1 }) jobs!: string[];
}
export class SavedJobs {
  @ListOf(Text) added!: string[];
}
```

```ts file=mcp/shortlist.server.ts
import { McpServer, McpServerClient } from "agboss/mcp";
import { FileContent, FileRead, FileWrite, FileWritten } from "./shortlist.dto.js";

const tools = {
  read_text_file: { input: FileRead, output: FileContent },
  write_file: { input: FileWrite, output: FileWritten },
};

@McpServer({
  name: "shortlist",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "./shortlist"],
  tools,
})
export class ShortlistServer extends McpServerClient<typeof tools> {}
```

```ts file=mcp/save-shortlist.mcp.ts
import { InjectionToken, TerminalUserChannel, type ToolHandler } from "agboss";
import { McpTool } from "agboss/mcp";
import { ChosenJobs, SavedJobs } from "./shortlist.dto.js";
import { ShortlistServer } from "./shortlist.server.js";

export const SHORTLIST = new InjectionToken<string>("SHORTLIST");

@McpTool({
  server: ShortlistServer,
  name: "save_shortlist",
  description: "Save the jobs the user chose to their shortlist",
  channel: TerminalUserChannel, // a write the user approves first
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
    const { content } = await this.server.call("read_text_file", { path: this.file }); // typed by `tools`
    const added = jobs.filter((job) => !content.includes(job));
    await this.server.call("write_file", { path: this.file, content: [content, ...added].join("\n") });
    return { added };
  }
}
```

- `server.call(name, args)` — the name and arguments are checked by the compiler (by the DTOs'
  fields), validated and parsed by the declared DTOs.
- At startup every declared server tool must exist on the server with a compatible input schema, or
  the app stops naming it.
- Test without a process: `mcpServerStub(ShortlistServer, { write_file: … })` in a unit test, or
  `mcpOf(ShortlistServer)` in a workflow test ([Testing](Testing)).

## A knowledge base

`@Rag` classes in `rag/`, bound by agents with a required mode — see [Knowledge bases](Knowledge-bases).

## The module

<!-- snippet-context
import { Agent, Router, WorkflowFinish, WorkflowStart } from "agboss";
import { WorkflowFinishText, WorkflowStartText } from "agboss/dto";
import { SearchOrders } from "./tools/search-orders.tool.js";
import { SaveShortlist, SHORTLIST } from "./mcp/save-shortlist.mcp.js";
@WorkflowStart({ name: "chat", description: "A message", input: WorkflowStartText })
class ChatWorkflowStart { declare readonly input: WorkflowStartText; }
@WorkflowFinish({ name: "chat", description: "The answer", output: WorkflowFinishText })
class ChatWorkflowFinish {}
@Agent({ name: "support", description: "Orders", prompt: "Answer about orders.", model: "moonshotai/kimi-k2.6", tools: [SearchOrders] })
class SupportAgent {}
@Agent({ name: "shortlist", description: "Shortlist", prompt: "Keep the shortlist.", model: "moonshotai/kimi-k2.6", tools: [SaveShortlist] })
class ShortlistAgent {}
@Router({ name: "main", description: "Routes", prompt: "Pick who handles the message.", model: "typesafe/jev-1.13", maxVisits: 3, routes: [{ prompt: "Orders", target: SupportAgent }, { prompt: "The shortlist", target: ShortlistAgent }, { prompt: "Stop and send the answer: the message is answered", target: ChatWorkflowFinish }] })
class MainRouter {}
-->

```ts
import {
  TerminalUserChannel,
  Workflow,
  WorkflowSettings,
  from,
  provide,
  type WorkflowDefinition,
} from "agboss";
import { usd } from "agboss/units";
import { ShortlistServer } from "./mcp/shortlist.server.js";
import { OrdersService } from "./services/orders.service.js";

@Workflow({
  name: "shop",
  version: "2.0.0",
  flow: [
    from(ChatWorkflowStart).next(MainRouter),
    from(MainRouter).routes(),
    from(SupportAgent, ShortlistAgent).next(MainRouter),
  ],
  defaults: {
    models: { temperature: 0 },
    router: { kind: "jev", model: "typesafe/jev-1.13" },
    tools: { maxToolCalls: 8 },
    history: { limit: 5 },
  },
  mcp: [ShortlistServer],
  providers: [OrdersService, provide(SHORTLIST, "./shortlist/shortlist.md")],
  channelClasses: [TerminalUserChannel],
})
export class Shop implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder()
      .limits({ perRun: { steps: 12, cost: usd(0.1) }, perDay: { cost: usd(1) } })
      .build();
  }
}
```

- `providers` registers what components inject: classes (`@Injectable({ deps })`, created by the
  container) and values (`provide(TOKEN, value)` for an `InjectionToken<T>`; a raw
  `{ provide, useValue }` does not compile). The core provides `ROUTER_FACTORY` (router engines for
  cheap decisions inside components) and `ENV` (the [environment](Configuration#environments)).
- **Scopes**: `scope: "app"` (default, one instance shared by every run) or `"run"` (one per run, its
  `onDestroy` when the run ends). An app-scoped component depending on a run-scoped one fails with
  `[di.scope-mismatch]`.
- **Assembly** (`workflowOf` / `createApp`, before the first request): the dependency graph is checked
  and every instance is created once, dependencies first. A cycle, an unregistered provider
  (`Consumer: "TOKEN" is not registered …`), an undecorated class in `providers`
  (`[di.undecorated-provider]`), a tool with a `channel` missing from `channelClasses`, a missing
  prompt file or prompt variable fail with the component's name.
- `agboss describe` shows each tool's dependencies.

## Add…

- **a tool** — `tools/<name>.dto.ts` + `tools/<name>.tool.ts`, listed in an agent's `tools`; a service
  it needs goes in `providers`.
- **an agent** — `agents/<name>.agent.ts` (+ `<name>.prompt.md`), one route in its router's `routes`,
  and its source in the flow (`from(…, NewAgent).next(MainRouter)`).
- **an MCP server** — `@McpServer` + `@McpTool` classes in `mcp/`, the server in `@Workflow({ mcp })`.

`agboss generate <kind> <name> --workflow <path>` (alias `agb g`) writes and wires each of them
([CLI](CLI)).

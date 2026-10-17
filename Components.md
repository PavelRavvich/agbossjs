# Components

A workflow is built from **annotated classes**, one per file, in folders by kind — Angular style.
Decorators carry metadata; behaviour is a contract the class implements (like `implements OnInit`);
dependencies come through the **constructor**. The compiler checks every link. Decision:
[ADR-0009](ADR-0009-Angular-style-components-with-constructor-injection). Every block on this page
compiles against the current package.

```
examples/job-scout/src/
  job-scout.workflow.ts            @Workflow — the module (the paths, defaults, providers; limits in settings())
  workflow-starts/  routers/  agents/  actions/  workflow-finishes/
  tools/  services/  mcp/  rag/  helpers/  environments/
```

The example `examples/job-scout` uses every kind below — see [Example](Example).

## Component rules

Every component reads the same way, top to bottom:

1. **The decorator holds metadata** (name, description, input / output DTOs, `deps`). A flow
   node's `name` is kebab-case and ends with its kind — `support-agent`, `main-router`,
   `charge-action`, `chat-workflow-start`, `chat-workflow-finish`, `shop-workflow`
   (`[name.kind-suffix]`) — explicit, never derived from the class, and unique in the application:
   it keys records, checkpoints, traces, golden sets and the generated types.
2. **The constructor holds the dependencies** — `private readonly` parameters.
3. **The methods implement a contract**:
   - your own implementation → `implements` the contract (`ToolHandler<In, Out>` for `@Tool` /
     `@McpTool`, `ActionHandler<Self>` for `@Action`, `FinishHandler<Self>` for a `@WorkflowFinish`
     with `input`, `RagConnector` for `@Rag`, `JudgeHandler` for `@Judge`);
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
| `actions/<name>.action.ts`                     | an `@Action` — code without a model                                      |
| `agents/<name>-agent.options.ts`               | an options const two agents share (`satisfies Omit<AgentOptions, …>`)    |
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
(`[prompt.unknown-variable]`), a missing file fails with `[prompt.missing-file]`. Prompts are
instructions only: what a node reads comes in its input message ([Path scope](Path-scope)), never
as `{{input.…}}` (`[prompt.input-in-instructions]`).

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

Data shapes — tool inputs and outputs, server tools, the inputs and outputs of flow nodes — are
**classes with one field decorator per field**, imported from `agboss/dto`. A DTO on a path (a
node's `input` / `output`, `.returns(…)`, `caseOf(…)`) ends with `Dto` (`[dto.name]`) and its class
name is unique in the application (`[dto.duplicate-name]`); on paths they are wrapped as
`listOf(Dto)`, `oneOf(A, B)`, `optional(Dto)` (input only) and `variant(Dto, value)` (an action
returning one class of its `oneOf`). zod stays inside the framework.
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
- **Names**: a tool's input and output are a pair from one noun — `FileRead` → `FileContent`,
  `JobQuery` → `JobMatches`. A tool that takes nothing: `input: NoInputDto`. A flow DTO ends with `Dto`
  (`OrderRequestDto`, `OfferDraftDto`).

## An agent

<!-- snippet-context
import { SearchOrders } from "./tools/search-orders.tool.js";
-->

```ts
import { Agent } from "agboss";
import { Reasoning } from "agboss/models";

@Agent({
  name: "support-agent",
  description: "Answers questions about orders", // what routers read
  promptUrls: ["./support.prompt.md"], // next to this file; or prompt: "…"
  model: "moonshotai/kimi-k2.6",
  reasoning: Reasoning.off(),
  maxTokens: 2000,
  tools: [SearchOrders],
})
export class SupportAgent {}
```

Without `input` / `output` it is a **text agent**: it reads the message (`WorkflowStartTextDto`)
and answers text. With them it reads its fields from the path's scope and answers through answer
tools ([Agents](Agents)):

```ts no-check: a fragment — the DTOs are declared by the project
@Agent({
  name: "editor-agent",
  description: "Rewrites the draft by the review notes",
  promptUrls: ["./editor.prompt.md"],
  model: "moonshotai/kimi-k2.6",
  input: { draft: OfferDraftDto, changes: ChangesRequestedDto }, // read by type from the path
  output: OfferDraftDto, // or oneOf(ADto, BDto), listOf(XDto)
  maxVisits: 2, // the third edit is refused before its model call
})
export class EditorAgent {}
```

Two stages of the same work are two classes sharing an options const — one class is one node:

```ts no-check: a fragment — the DTOs are declared by the project
// agents/reviewer-agent.options.ts
export const reviewerAgentOptions = {
  promptUrls: ["./reviewer.prompt.md"],
  model: "moonshotai/kimi-k2.6",
  input: { article: ArticleDto },
  output: ReviewDto,
} satisfies Omit<AgentOptions, "name" | "description">;

// agents/final-reviewer.agent.ts
@Agent({ ...reviewerAgentOptions, name: "final-reviewer-agent", description: "Reviews before publishing" })
export class FinalReviewerAgent {}
```

The options must be a static object (a call or a conditional spread → `[agent.dynamic-options]`).
The other options — `temperature`, `cache`, `maxToolCalls`, `historyLimit`, `historySummaries`,
`judges` + `maxRetries`, `rag` (`RagMode.Tool` / `RagMode.Context`), `memoryStrategy`, guardrails
and PII policies — are on [Configuration](Configuration) and the pages of each feature. How the
agent runs: [Agents](Agents).

## An action

Code without a model, a node of the flow (`.toAction(ChargeAction)`):

```ts no-check: a fragment — the DTOs are declared by the project
@Action({
  name: "charge-action",
  description: "Charges the card",
  input: { order: OrderDto },
  output: ReceiptDto,
  deps: [PaymentsService],
})
export class ChargeAction implements ActionHandler<ChargeAction> {
  constructor(private readonly payments: PaymentsService) {}

  async execute(input: InputOf<ChargeAction>, ctx: ActionContext): Promise<OutputOf<ChargeAction>> {
    // each field is { value, producer }; ctx.idempotencyKey = `${runId}:${node}:${visit}`
    return this.payments.charge(input.order.value, ctx.idempotencyKey);
  }
}
```

What it throws is the step's failure (`ActionFailedError`, the original in `cause`), taken by an
`.onError(…)` right after it ([Rollback](Rollback)).

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
import { Agent, DecidedBy, Router, WorkflowFinish, WorkflowStart } from "agboss";
import { WorkflowFinishTextDto } from "agboss/dto";
import { SearchOrders } from "./tools/search-orders.tool.js";
import { SaveShortlist, SHORTLIST } from "./mcp/save-shortlist.mcp.js";
@WorkflowStart({ name: "chat-workflow-start", description: "A message", input: WorkflowStartTextDto })
export class ChatWorkflowStart {}
@WorkflowFinish({ name: "chat-workflow-finish", description: "The answer", output: WorkflowFinishTextDto })
export class ChatWorkflowFinish {}
@Agent({ name: "support-agent", description: "Orders", prompt: "Answer about orders.", model: "moonshotai/kimi-k2.6", tools: [SearchOrders] })
export class SupportAgent {}
@Agent({ name: "shortlist-agent", description: "Shortlist", prompt: "Keep the shortlist.", model: "moonshotai/kimi-k2.6", tools: [SaveShortlist] })
export class ShortlistAgent {}
@Router({ name: "main-router", description: "Routes", decidedBy: DecidedBy.Model, prompt: "Pick who handles the message.", model: "typesafe/jev-1.13", input: { message: WorkflowStartTextDto }, routes: [{ prompt: "Orders", target: SupportAgent }, { prompt: "The shortlist", target: ShortlistAgent }] })
export class MainRouter {}
-->

```ts
import {
  TerminalUserChannel,
  Workflow,
  WorkflowSettings,
  provide,
  route,
  start,
  type WorkflowDefinition,
} from "agboss";
import { WorkflowStartTextDto } from "agboss/dto";
import { usd } from "agboss/units";
import { ShortlistServer } from "./mcp/shortlist.server.js";
import { OrdersService } from "./services/orders.service.js";

@Workflow({
  name: "shop-workflow",
  version: "2.0.0",
  flow: [
    start(ChatWorkflowStart)
      .returns(WorkflowStartTextDto)
      .toRouter(MainRouter)
      .chooseOne(
        route(SupportAgent).toFinish(ChatWorkflowFinish),
        route(ShortlistAgent).toFinish(ChatWorkflowFinish),
      ),
  ],
  defaults: {
    models: { temperature: 0 },
    router: { model: "typesafe/jev-1.13" },
    tools: { maxToolCalls: 8 },
    history: { limit: 5 },
  },
  maxSteps: 6,
  mcp: [ShortlistServer],
  providers: [OrdersService, provide(SHORTLIST, "./shortlist/shortlist.md")],
  channelClasses: [TerminalUserChannel],
})
export class Shop implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder()
      .limits({ perRun: { cost: usd(0.1) }, perDay: { cost: usd(1) } })
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
  and its path in the router's choice (`route(NewAgent).toFinish(…)`).
- **an action** — `actions/<name>.action.ts`, a step of a path (`.toAction(NewAction)`).
- **an MCP server** — `@McpServer` + `@McpTool` classes in `mcp/`, the server in `@Workflow({ mcp })`.

`agboss generate <kind> <name> --workflow <path>` (alias `agb g`) writes and wires each of them,
then regenerates `.agboss/types.d.ts` ([CLI](CLI)).

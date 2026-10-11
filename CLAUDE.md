# CLAUDE.md

Multi-agent project on LangGraph + LangChain (TypeScript). Built with a three-phase pipeline:
**triage → spec → implement**. Code is the only source of truth; tickets hold the reasoning.

## Stack

- Node 22+, TypeScript (strict, fully typed — see `QUALITY.md` → Types), ESM
- `@langchain/langgraph` (graph, and each agent's own loop as a subgraph), `@langchain/core`
  (messages, prompts, tools, test fakes), `zod` (inside the framework only — workflows use DTO
  classes, `graphcompose/dto`)
- LLM access: **OpenRouter** only. Env: `OPENROUTER_API_KEY` (+ optional `OPENROUTER_BASE_URL`).
  - Routers: each `@Router` names its own `model` — a **decision model** (`DECISION_MODELS`: Jev,
    `openai/gpt-6-luna-decisions`, pplx-decider, Clef, …; OpenRouter Decisions API via
    `DecisionsModelProvider` — probabilities, exact cost) or any chat model. Guards use
    `defaults.router` (Jev). Judges on a decision model call `ctx.model.decide` with
    `Decision.noul` / `Decision.choice` / `Decision.score` / `Decision.image` (typed answers);
    `invoke` or `decide` on the wrong kind of model → `ModelKindError`.
  - Agents: cheap chat models (default `moonshotai/kimi-k2.6`) via `@langchain/openai`, each with
    `maxTokens` (`MODEL_MAX` = model's maximum), `thinking`, `cache`.
  - Everything is set in the workflow's components (`@Workflow` with its `flow` and `settings()`,
    `@Router`, `@Agent`) — reference: Architecture below (compiled by `make check`), then Wiki →
    Workflow, Routers, Components, Configuration (compiled by CI, see Quality gates).
- Observability: Langfuse tracing via env (`LANGFUSE_*` keys, loaded only when set). FinOps: built-in cost
  accounting; limits in the workflow's `settings().limits(...)` — per run (steps, cost) and per day
  (cost, resets 00:00 UTC); hitting any limit fails the run (`QUALITY.md` → FinOps).
- Vitest (+ v8 coverage), ESLint (`typescript-eslint` strict), Prettier,
  `@langchain/langgraph-cli` for LangGraph Studio

## Commands

| Command (repo root)                    | What it does                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `make setup`                           | install dependencies (npm workspaces)                                                    |
| `make check`                           | **the gate**: build + API reports + compiled docs + format + lint + typecheck + coverage |
| `npm run dev`                          | rebuild the framework on change (watch)                                                  |
| `npm run check:docs`                   | typecheck the docs' ts blocks, check the commands they mention                           |
| `make smoke`                           | real-model smoke tests of the framework (needs `.env`), never in CI                      |
| `make fmt`                             | auto-format                                                                              |
| `npm run studio`                       | LangGraph Studio (graphs from `langgraph.json`)                                          |
| `scripts/langfuse.sh up\|down\|status` | local Langfuse for tracing; writes keys to `.env`                                        |

In `examples/job-scout/` (each is `graphcompose <command> --workflow src/job-scout.workflow.ts`):
`npm run chat` · `npm run run -- "task"` · `npm run describe` · `npm run eval` / `replay` ·
`npm run golden -- add --name <n>` · `npm run compare -- --profiles base,<p> --golden <n>` ·
`npm run rag:index` · `npm run probe -- --place <p> <token…>` (Greenhouse boards). Any run command
takes `--profile <name>` (`profiles/<workflow>/<name>.yaml`) and `--thread <id>`.

## Architecture

Everything below is checked against the code: every ` ```ts ` block of this file compiles against
the built package (`npm run check:docs`), and the worked example is assembled and run by script in
the framework's tests (`tests/docs/claude-md.test.ts`). If a block here is wrong, `make check` fails.

### A workflow, end to end

A workflow is a folder of components, one class per file, wired by a `*.workflow.ts` module.
Commands find it by path (`gc chat --workflow src/desk/desk.workflow.ts`). The shape every
workflow follows — a support desk with one tool, one injected service, one agent and a router:

```ts file=src/desk/tools/order-status.dto.ts
// tools/order-status.dto.ts — data crossing a tool boundary are DTO classes, one decorator per field
import { Text } from "graphcompose/dto";

export class OrderQuery {
  @Text({ prompt: "the order id" })
  orderId!: string;
}

export class OrderInfo {
  @Text({ prompt: "where the order is" })
  status!: string;
}
```

```ts file=src/desk/services/order-book.service.ts
// services/order-book.service.ts — a service: does the I/O, created by the container
import { Injectable } from "graphcompose";

@Injectable()
export class OrderBook {
  statusOf(orderId: string): Promise<string> {
    return Promise.resolve(`order ${orderId} shipped`);
  }
}
```

```ts file=src/desk/tools/order-status.tool.ts
// tools/order-status.tool.ts — `deps` lists the constructor's dependencies, in order (compiler-checked)
import { Tool, type ToolContext, type ToolHandler } from "graphcompose";
import { OrderBook } from "../services/order-book.service.js";
import { OrderInfo, OrderQuery } from "./order-status.dto.js";

@Tool({
  name: "order_status",
  description: "The status of an order",
  input: OrderQuery,
  output: OrderInfo,
  deps: [OrderBook],
})
export class OrderStatus implements ToolHandler<OrderQuery, OrderInfo> {
  constructor(private readonly book: OrderBook) {}

  async run({ orderId }: OrderQuery, ctx: ToolContext): Promise<OrderInfo> {
    ctx.run.signal.throwIfAborted(); // the run: runId, threadId, signal, metadata, owner, input
    return { status: await this.book.statusOf(orderId) };
  }
}
```

```ts file=src/desk/agents/support.agent.ts
// agents/support.agent.ts — the agent's own loop: its model, prompt and tools
import { Agent } from "graphcompose";
import { OrderStatus } from "../tools/order-status.tool.js";

@Agent({
  name: "support",
  description: "Answers questions about orders",
  promptUrls: ["./support.prompt.md"],
  model: "moonshotai/kimi-k2.6",
  tools: [OrderStatus],
})
export class SupportAgent {}
```

```md file=src/desk/agents/support.prompt.md
You answer questions about orders. Look every order up with order_status; never guess a status.
```

```ts file=src/desk/workflow-starts/chat.workflow-start.ts
// workflow-starts/chat.workflow-start.ts — where a run starts: its input DTO
import { WorkflowStart } from "graphcompose";
import { WorkflowStartText } from "graphcompose/dto";

@WorkflowStart({ name: "chat", description: "A customer's message", input: WorkflowStartText })
export class ChatWorkflowStart {
  declare readonly input: WorkflowStartText; // types app.execute(ChatWorkflowStart, input)
}
```

```ts file=src/desk/workflow-finishes/chat.workflow-finish.ts
// workflow-finishes/chat.workflow-finish.ts — where a run finishes: its output DTO
import { WorkflowFinish } from "graphcompose";
import { WorkflowFinishText } from "graphcompose/dto";

@WorkflowFinish({ name: "chat", description: "The answer", output: WorkflowFinishText })
export class ChatWorkflowFinish {}
```

```ts file=src/desk/routers/main.router.ts
// routers/main.router.ts — `prompt` says how to choose, `routes` what each choice means
import { Router } from "graphcompose";
import { SupportAgent } from "../agents/support.agent.js";
import { ChatWorkflowFinish } from "../workflow-finishes/chat.workflow-finish.js";

@Router({
  name: "main",
  description: "Sends the message to the agent that handles it, or sends the answer",
  prompt: "Pick who handles the customer's message next.",
  model: "typesafe/jev-1.13",
  maxVisits: 3,
  routes: [
    { prompt: "Questions about orders", target: SupportAgent },
    {
      prompt:
        "Stop and send the answer: the contributions so far answer the message, or the last agent asked a question and waits for the reply, or it cannot be done",
      target: ChatWorkflowFinish,
    },
  ],
})
export class MainRouter {}
```

```ts file=src/desk/desk.workflow.ts
// desk.workflow.ts — the module: the graph (`flow`), defaults, providers; limits in settings()
import { Workflow, WorkflowSettings, from, type WorkflowDefinition } from "graphcompose";
import { usd } from "graphcompose/units";
import { SupportAgent } from "./agents/support.agent.js";
import { MainRouter } from "./routers/main.router.js";
import { OrderBook } from "./services/order-book.service.js";
import { ChatWorkflowStart } from "./workflow-starts/chat.workflow-start.js";

@Workflow({
  name: "desk",
  version: "1.0.0",
  flow: [
    from(ChatWorkflowStart).next(MainRouter),
    from(MainRouter).routes(), // the targets are the router's `routes` — the one list of them
    from(SupportAgent).next(MainRouter),
  ],
  defaults: {
    models: { temperature: 0 },
    router: { kind: "jev", model: "typesafe/jev-1.13" },
    tools: { maxToolCalls: 4 },
    history: { limit: 5 },
  },
  providers: [OrderBook],
})
export class Desk implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder()
      .limits({ perRun: { steps: 8, cost: usd(0.05) }, perDay: { cost: usd(1) } })
      .build();
  }
}
```

The test drives it by script — no model, no network:

```ts file=tests/desk.test.ts
import { expect } from "vitest";
import { callTool, replyWith, routeTo, testWith } from "graphcompose/testing";
import { Desk } from "../src/desk/desk.workflow.js";
import { MainRouter } from "../src/desk/routers/main.router.js";
import { SupportAgent } from "../src/desk/agents/support.agent.js";
import { OrderBook } from "../src/desk/services/order-book.service.js";
import { OrderStatus } from "../src/desk/tools/order-status.tool.js";
import { ChatWorkflowStart } from "../src/desk/workflow-starts/chat.workflow-start.js";
import { ChatWorkflowFinish } from "../src/desk/workflow-finishes/chat.workflow-finish.js";

const test = testWith(Desk);

test("an order question goes to support, which looks the order up", async ({ app, mockLlm }) => {
  mockLlm(MainRouter).thenReturn(routeTo(SupportAgent), routeTo(ChatWorkflowFinish));
  mockLlm(SupportAgent).thenReturn(
    callTool(OrderStatus, { orderId: "7" }),
    replyWith("Order 7 has shipped."),
  );

  const result = await app.execute(ChatWorkflowStart, { text: "where is order 7?" });

  expect(result).toFollowPath([
    ChatWorkflowStart,
    MainRouter,
    SupportAgent,
    MainRouter,
    ChatWorkflowFinish,
  ]);
  expect(result).toFinishWith(ChatWorkflowFinish, { text: "Order 7 has shipped." });
});

test("a service is replaced by a mock", async ({ app, mockLlm, mockOf }) => {
  mockOf(OrderBook).statusOf.mockResolvedValue("order 7 lost");
  mockLlm(MainRouter).thenReturn(routeTo(SupportAgent), routeTo(ChatWorkflowFinish));
  mockLlm(SupportAgent).thenReturn(callTool(OrderStatus, { orderId: "7" }), replyWith("Lost."));

  await app.execute(ChatWorkflowStart, { text: "where is order 7?" });

  expect(mockOf(OrderBook).statusOf.mock.calls).toEqual([["7"]]);
});
```

```ts file=vitest.config.ts
// vitest.config.ts — registers the workflow matchers (toFollowPath, toFinishWith, …)
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], setupFiles: ["graphcompose/testing/setup"] },
});
```

**Adding an agent** = its `agents/<name>.agent.ts` (+ `<name>.prompt.md`), one route in its
router's `routes`, and its source in the flow (`from(…, NewAgent).next(MainRouter)`). **Adding a
tool** = `tools/<name>.dto.ts` + `tools/<name>.tool.ts`, listed in an agent's `tools`; a service it
needs goes in `providers`. `gc generate <kind> <name> --workflow <path>` writes and wires both.

### The flow DSL

`@Workflow({ flow: [...] })` is the graph, built into LangGraph and checked at assembly:

<!-- snippet-context
import { Agent, BatchParallelStrategy, LimitExceededError, Router, catchError, chain, from, node, type Flow } from "graphcompose";
import { ChatWorkflowStart } from "./src/desk/workflow-starts/chat.workflow-start.js";
import { ChatWorkflowFinish } from "./src/desk/workflow-finishes/chat.workflow-finish.js";
@Agent({ name: "planner", description: "Plans", prompt: "Plan.", model: "m" }) class Planner {}
@Agent({ name: "researcher", description: "Researches", prompt: "Research {{item}}.", model: "m" }) class Researcher {}
@Agent({ name: "critic", description: "Critiques", prompt: "Critique.", model: "m" }) class Critic {}
@Agent({ name: "writer", description: "Writes", prompt: "Write.", model: "m" }) class Writer {}
@Router({ name: "review", description: "Reviews", prompt: "Pick.", model: "m", routes: [{ prompt: "Done", target: ChatWorkflowFinish }] }) class ReviewRouter {}
@BatchParallelStrategy() class Topics { extract(): string[] { return ["a", "b"]; } }
export const flows: Flow[] = [
// @snippet
];
-->

```ts
[
  from(ChatWorkflowStart).next(Planner), // unconditional; from(A, B).next(C) is a fan-in
  from(ReviewRouter).routes(), // the router picks one of its @Router({ routes }) targets
  chain(ChatWorkflowStart, Planner, Writer, ReviewRouter), // a straight line, a router only last
  from(Planner).nextParallel(Researcher, Critic), // fan-out: both run
  from(Researcher, Critic).join(Writer), // waits for both
  from(Planner).batchParallel(Researcher, Topics, { concurrencyLimit: 2, batchSize: 1 }),
  catchError(Writer, LimitExceededError).next(ChatWorkflowFinish), // a failure goes on, by code
],
[chain(ChatWorkflowStart, Writer, node(Writer, "second-draft"), ChatWorkflowFinish)],
```

- `batchParallel(Target, Strategy, { concurrencyLimit, batchSize })`: a `@BatchParallelStrategy()`
  class's `extract(state)` returns the items; each target run sees its item as `{{item}}` in its
  prompt (an action as `ctx.item`).
- `catchError(Node, ErrorClass).next(Handler)` matches by the error's stable `code` — the class's,
  its subclasses', and anything it caused — on a plain record in state, so it holds after a resume;
  `compensateWith` is the same step for a compensating target.
- `node(Class, "name")` — a second place for a class, declared once as a constant;
  `from(A, B).joinQuorum(Strategy, { min }).routes(Target)` — the first `min` answers are enough.
- **Node kinds:** `@WorkflowStart` (input DTO, input guards), `@Router`, `@Agent`,
  `@WorkflowAction` (code, no model: `execute(state, ctx)`), `@WorkflowFinish` (output DTO, output
  guards). A start declares `declare readonly input: Dto`, so `app.execute(Start, input)` checks
  `input` and rejects a class that is not a start. LangGraph node ids are `<kind>.<name>`.
- **Assembly rules** fail before any model call with **all** violations at once (`GraphRuleError`,
  stable codes `graph.*` / `router.*`): every node decorated, one next step per node, `routes()` only
  from a router, a cycle needs a router (with `maxVisits`), a workflow start exists, no unreachable
  node or dead end, nothing after a workflow finish.
- **Routers:** a route **to a workflow finish** is worded as a stop instruction
  ("Stop and send the answer: …"), never "the answer is ready". A router that fails or picks an unknown route **fails the
  run** (`RouterDecisionError`). A router's `model` is a decision model (Jev, …) or a chat model.

### Components and dependency injection

- **One class per file, folders by kind:** `workflow-starts/`, `routers/`, `agents/`,
  `workflow-finishes/`, `tools/`, `services/`, `mcp/`, `rag/`, `environments/`; files
  `*.workflow-start.ts`, `*.router.ts`, `*.agent.ts` (+ `*.prompt.md`), `*.workflow-finish.ts`,
  `*.tool.ts`, `*.dto.ts`, `*.service.ts`, `*.server.ts` + `*.mcp.ts`, `*.rag.ts`, `*.helper.ts`.
- **Decorator = metadata, constructor = dependencies, methods = a contract:** `implements` for your
  own (`ToolHandler<In, Out>`, `JudgeHandler`, `RagConnector`), `extends` + `override` for a standard
  implementation (`McpServerClient`, `SqliteFtsConnector`). Prompts are `prompt` (inline) or
  `promptUrls` (files next to the component) plus `promptVariables`; `{{variables}}` are checked at
  assembly (`[prompt.unknown-variable]`), and so is `{{input.<field>}}` (the start's input, filled
  per run) against the workflow's starts' input DTOs.
- **`deps`, one contract for every kind** (`@Injectable`, `@Tool`, `@McpTool`, `@Rag`, `@Judge`,
  `@WorkflowAction`, `@Guardrail`, `@PiiPolicy`, `@Channel`, inbound adapters): `deps` are checked
  against the constructor by the compiler and injected by the container. A token is a class or an
  `InjectionToken<T>`; values go in with `provide(TOKEN, value)` (a raw `{ provide, useValue }`
  does not compile). A dependency without a provider fails at assembly (`Consumer: "TOKEN" is not
registered …`); a class in `providers` without a decorator fails with `[di.undecorated-provider]`.
- **Scopes (#184):** `scope: "app"` (default, one instance shared by every run) or `"run"` (one per
  run in a child container; `onDestroy` when the run ends). Per-run state belongs in a run-scoped
  component. App → run dependencies fail with `[di.scope-mismatch]`; lint
  (`graphcompose/no-run-state-in-singleton`) flags `this.x = …` in `run()` of an app-scoped one.

<!-- snippet-context
import { Injectable, InjectionToken, provide, type Provider } from "graphcompose";
interface SearchConfig { readonly maxResults: number }
// @snippet
export const providers: Provider[] = [SearchSession, provide(SEARCH_CONFIG, { maxResults: 20 })];
-->

```ts
export const SEARCH_CONFIG = new InjectionToken<SearchConfig>("SEARCH_CONFIG");

@Injectable({ scope: "run", deps: [SEARCH_CONFIG] })
export class SearchSession {
  readonly seen = new Set<string>(); // one per run: never shared between two runs
  constructor(readonly config: SearchConfig) {}
}
```

- **Data are DTO classes** (`graphcompose/dto`): `@Text`, `@Integer`, `@Flag`, `@OneOf`,
  `@ListOf`, `@Nested`, …; plain data, no methods. Standard ones: `WorkflowStartText`,
  `WorkflowFinishText`, `ToolCallApprovalDecision`, `RagSearchResult`, `PlainText`. zod stays inside
  the framework.
- **Tool names** are unique over what a model sees — local, MCP and `search_<rag>` — else
  `[tool.duplicate-name]`. A tool with a `channel` (approval) needs that channel in
  `@Workflow({ channelClasses })`, else assembly fails.
- **Observers are registered**, not discovered: `@Workflow({ observers: [...] })`, typed hooks
  (`implements OnToolEnd, …`); an observer with no or a misspelled hook fails assembly
  (`[observer.no-hooks]`, `[observer.unknown-hook]`), one that throws is a warning. Workflow
  events: `onWorkflowStart` once per run, `onWorkflowPause` / `onWorkflowResume` around a pause,
  `onWorkflowEnd` / `onError` when the run ends — also after a resume (a cancelled paused run:
  `onError`, `WorkflowCancelledError`); all events carry the run's `runId` and real `threadId`.
  A request refused before a run starts or is located (another owner's thread, nothing paused, an
  unknown thread, an invalid start input) → `onRunRejected` (`operation`, `threadId?`, `code`,
  `message` without input values, no `runId`), still thrown; `IncompatibleResumeError` → `onError`
  on the paused run (its `runId`), which stays paused.
- **Memory** (`graphcompose/memory`): agents see the thread's last `defaults.history.limit` turns
  (+ `compaction` summaries); `@Agent({ memoryStrategy })` replaces that for one agent
  (`extends BaseMemoryStrategy`).
- **Knowledge bases:** a `@Rag` class implementing `RagConnector`, bound per agent with
  `rag: [{ use, mode: "tool" | "context" }]`. **MCP:** `@McpServer` (`extends McpServerClient`)
  in `mcp: [...]`, its tools as `@McpTool` classes.

### Environments

The app's settings live in `environments/` next to the workflow file: the contract in
`environment.ts` (`declare module "graphcompose" { interface Environment { … } }`), the values in
`<name>.environment.ts` (`export default defineEnvironment({ … })`, `fromEnv("VAR", { default,
secret })` for process variables). Services inject them with `ENV` (`@Injectable({ deps: [ENV] })`,
`constructor(env: Environment)`), never `process.env`. `--env <name>` / `createApp(W, { env })` /
`testWith(W, { env | environment })` pick one (default `dev`); a missing value fails at start
naming it. Model provider keys stay process variables (`EnvironmentVariable.named`). README →
Environments has the full example.

### Judges and decision models

`@Agent({ judges: [AnswerGrounded], maxRetries: 1 })` runs each `@Judge({ name, model, deps })`
(`implements JudgeHandler`) on the agent's reply; a rejection goes back to the agent with the
feedback, and when retries are spent the run throws `QualityGateError`. A judge's own model is a chat
model (`ctx.model.invoke`) or a **decision model** (`ctx.model.decide({ state, questions })` with
`Decision.noul` / `Decision.choice` / `Decision.score`, answers typed by the questions; `DECISION_MODELS`
served by `DecisionsModelProvider`). The wrong call for the model's kind throws `ModelKindError`.
Routers and guards use decision models too. README → Quality gates has a full judge.

### Runs: context, limits, errors

- `app.execute(Start, input, { thread, owner, signal, metadata, onStream })` → `ExecutionOutput`
  (`output` is the finish DTO, `path`, `spend`, `thread`, `runId`); `app.resume(thread, decision)` continues a
  paused run; `app.cancel(thread)` aborts a running one (`WorkflowCancelledError`) or drops a paused
  one (`resume` → `NotPausedError`). A thread with an `owner` rejects another owner
  (`ThreadOwnerError`).
- Tools and actions read their run as `ctx.run` (`RunContext`: `runId`, `threadId`, `signal`,
  `metadata`, `owner`, `input` = the start's whole validated input, checkpointed). One run id per
  run, made once by the app: observer events, `ctx.run.runId`, the Tern and the result share it,
  also on resume. Actions get `ctx.idempotencyKey` = `${runId}:${node}` (`:${index}` in a
  batch), tools `ctx.callId`. Framework code reads it with the internal `extractRunContext` — never
  by parsing `configurable`.
- **Limits** in `settings()`: `.limits({ perRun: { steps, cost }, perDay: { cost } })` (values with
  units: `usd()`). Steps = visits of agents and routers (default (agents + routers) × 3). Hitting one
  **fails the run** with `LimitExceededError` naming the key (`limits.perRun.steps`,
  `limits.perRun.cost`, `limits.perDay.cost`, `routers.<name>.maxVisits`; money:
  `BudgetExceededError`). `perDay.cost` requires `perRun.cost` (`[limits.per-run-required]`).
- **Errors** (root entry) are `GraphComposeError`s with stable `code`s (`limit` ⊃ `limit.budget`,
  `step.agent` / `step.guard` / `step.router`, `workflow.cancelled`, …); a new error class gets a
  `static code`.

### Testing

- Whole workflows: `testWith(Workflow, options?)` from `graphcompose/testing` gives Vitest fixtures
  `app`, `mockLlm`, `mockOf`, `mcpOf`, `recoverApp`; models answer by script — `replyWith(text)`,
  `callTool(Tool, args)` (args typed by the tool's input DTO), `routeTo(Target)`,
  `decideWith(answers)` (a decision judge), `failWith(ModelFailure.Timeout)`; the network is blocked.
  Matchers by class: `toFollowPath`, `toFinishWith`, … (`setupFiles: ["graphcompose/testing/setup"]`).
- A recorded run instead of scripts: `testWith(W, { vcr: { cassetteName, dir, mode: VCRMode.REPLAY } })`
  — an unrecorded call throws `CassetteMissingError` (REPLAY by default under `CI`).
- Units: `toolOf(new Tool(fakes))` for a tool, `testRunContext()` for a `ctx.run`, fakes from
  `@langchain/core/utils/testing`. Tests never call a real model; real-model checks are `make smoke`.

### Imports

An example (and any project) imports only the public entries: the root `graphcompose` (decorators,
DI, flow DSL, settings, environments, observers, judges and decisions, `createApp`, errors, types),
`graphcompose/dto`, `/units`, `/models`, `/testing` (+ `/testing/setup`), and the integrations `/mcp`,
`/rag`, `/a2a`, `/memory`. ESLint enforces it from `packages/graphcompose/package.json#exports`
minus `deprecatedExports` (`scripts/public-entries.mjs`): a new entry is allowed by adding it there,
never by an `eslint-disable`. `/core`, `/graph`, `/router`, `/tool`, `/channels`, `/concurrency` are
deprecated re-exports; `gc migrate imports` rewrites them. The root import has no side effects
(load tracing, MCP, SQLite lazily), and each name has one meaning across entries. A public surface
change updates the api-extractor reports (`npm run api:update` → `packages/graphcompose/api/*.api.md`).
The framework never imports `examples/` (ESLint-enforced).

### Quality gates

`make check` = `npm run check`: the root allowlist (`.root-allowlist`), the suppression budget
(`.suppressions.json`), build, the API reports, **compiled docs**, prettier, ESLint, `tsc` (tests
included), tests with coverage, and `gc check --models` on the example. Compiled docs
(`scripts/check-docs.mjs`) typecheck every ` ```ts ` block of README, CLAUDE, QUALITY and WORKFLOW
(and `docs/`) against the built package, and check that every `scripts/…`, `npm run …`, `make …` and
`gc …` they mention — and every `gc …` the CLI prints — exists. CI also clones the GitHub Wiki and
runs `node scripts/check-docs.mjs --wiki wiki`: the same checks for every Wiki page, plus every link
between pages names an existing page. The Wiki changes outside PRs, so check it before publishing:
`node scripts/check-docs.mjs --wiki ../<repo>.wiki`. Snippet conventions (README, CLAUDE, Wiki alike):

- ` ```ts file=src/x.ts ` — written at that path, so other blocks of the same doc import it.
- A hidden `<!-- snippet-context … -->` comment right before a block supplies imports and
  declarations; a line `// @snippet` in it marks where the block goes (to wrap a fragment).
- ` ```ts no-check: <reason> ` opts a block out — the reason is required; use it sparingly.

## Naming grammar (#127)

Names repeat the same patterns everywhere, so one name lets you guess the others (Wiki →
Components):

- **Kind as the suffix, qualifier in front**: `MainRouter`, `CoderAgent`, `ChatWorkflowFinish`.
  DTOs are the exception: noun pairs from one root (`FileRead` → `FileContent`, `FileWrite` →
  `FileWritten`); a DTO that belongs to a component kind starts with that kind.
- **Hierarchy rule (#141)**: a DTO that belongs to a component kind starts with that kind
  (`WorkflowStartText`, `ToolCallApprovalDecision`, `RagSearchResult`); paired concepts get paired
  names (`@WorkflowStart` / `@WorkflowFinish`, `WorkflowPauseQuestion` / `WorkflowPauseAnswer`);
  nothing "chat", "user", "human" or "person" in framework names — a run may be a CI pipeline, an
  approval may come from a system.
- **When + what** for things tied to a moment: `BeforeToolCallJudge`, `AfterToolCallJudge`,
  `BeforeAgentAnswerJudge`.
- **One limit → flat `max…`** (`maxVisits`); **several related → an object** named by what they
  are, the scope stated once (`limits: { perRun: { steps, cost } }`).
- **Closed sets are enums**, not string unions, in the public API.
- **One field name per meaning** across variants (`reason` for every verdict).
- **Full words.** Kept abbreviations: DTO, PII, MCP, RAG, JSON, CSV, CLI, URL, ID, API and the
  command `gc`.
- Getting something for a component is `…Of` (`schemaOf`, `modelOf`); attaching is
  `<verb>(what).on(target)`; storage contracts are `…Repository` with Spring Data method names.
- **Values with units** — `usd(0.5)`, `seconds(30)`, `minutes(5)` (`graphcompose/units`), no `Ms` /
  `Usd` in names. `override…` only for replacing what is inherited.

## Conveyor

Board `Status`: **Triage → Backlog → In progress → Test → Done** (Done: human only).

| Stage              | Skill          | Output                                                                                                                     |
| ------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Triage             | `triage`       | business side (why / does / does not / constraints / acceptance criteria AC1…) in the issue; parent + sub-issues if needed |
| Backlog            | `spec-session` | spec, plan, tests + manual checks mapped to every AC, test cases in the issue                                              |
| In progress → Test | `implement`    | parallel waves; branch + PR (`Refs #N`) per issue, merged to `main`; manual-test handoff                                   |

Quizzes: `.claude/skills/QUIZ.md`. Stages: `scripts/ticket.sh status <N> <Status>`.

## Hard rules

- Read `WORKFLOW.md` (tracker, wiki, branches, PRs) and `QUALITY.md` (code, types, agents, FinOps,
  tests) before writing code.
- Tracker is GitHub Issues via `gh`. Every change belongs to an issue.
- Never commit to `main` directly. Branch from `main`: `<type>/<issue>-<slug>`.
- Every domain concept gets a named type; reusable code is generic.
- Every model call records usage; models come only from the registry.
- Never lower coverage thresholds, disable lint rules, or add `eslint-disable` / `@ts-ignore`
  to get green. Fix the code or stop and report.
- The gate enforces it (#180): `.suppressions.json` is a budget of every `eslint-disable`,
  `@ts-ignore`, `as any` and `as unknown as` — `make check` fails when a count goes up, and when it
  goes down until the budget is lowered (`node scripts/check-suppressions.mjs --write`). No
  file-scope `/* eslint-disable */`, ever. Tests must assert (`requireAssertions`) and must not fake
  framework failures (e.g. an interrupt by its name). The repo root is allow-listed
  (`.root-allowlist`): notes and specs go to Issues / Wiki.
- Tests never call a real LLM. A workflow is tested with `graphcompose/testing` (`testWith`: models
  by script, MCP servers stubbed, network blocked); units use fakes from `@langchain/core/utils/testing`.
- Read existing code before planning — the spec may be stale, the code is not.
- **No specs, plans or docs as files.** Specs and implementation plans → GitHub Issues (bodies via
  stdin). Docs → GitHub Wiki via `scripts/wiki.sh`. **ALWAYS update the `../<repo>.wiki` repository directly whenever making API, DSL, or architectural changes so that the wiki is always up-to-date** — checked with `node scripts/check-docs.mjs --wiki ../<repo>.wiki` before `scripts/wiki.sh publish`, and by CI. Decisions → wiki pages `ADR-NNNN-Title`.
- Inside the framework, `src/routers` never imports graph/agents/prompts, and the rest imports it
  only via `src/routers/index.ts` (ESLint-enforced; the same for `src/tools` and `src/terns`).
- **Example code before spec**: a new decorator or a new parameter enters a spec only after example
  code using it is agreed.
- New names follow the naming grammar (above, #127).
- Screenshots and scratch output go to `.artifacts/` (git-ignored).

## Layout

```
packages/graphcompose/        the framework (npm package `graphcompose`; builds to dist/; no command — see -cli)
  src/
    index.ts        the root entry `graphcompose` (public/: components, flow, observers, app) + errors.ts
    app/            createApp → app.execute / resume / close; app-deps.ts — production wiring (model gateway,
                    MCP, ledger, Terns, tracing), every part replaceable
    testing/        `graphcompose/testing`: testWith (Vitest fixtures), scripted gateway, matchers, setup.ts
    components/     @Tool @Agent @McpServer @McpTool @Rag @Injectable @Workflow, DI container, workflowOf
    dto/            `graphcompose/dto`: field decorators, DTO schemas and validation, standard/ DTOs
    units/          `graphcompose/units`: usd(), seconds(), minutes()
    workflow.ts     the assembled workflow type
    config/         typed config schema, profiles (YAML overlays), defaults resolution
    rag/            knowledge-base contract (RagConnector) + reference SQLite FTS5 connector
    graph/          flow.ts (DSL), route.ts, workflow-start / router / workflow-finish decorators,
                    rules.ts + check-flow.ts + router-rules.ts (assembly rules, rule-error.ts), build.ts
                    (LangGraph), limits.ts, settings.ts, flow-state.ts, visit.ts; nodes/ (flow-router,
                    agent loop, approval, guards, knowledge, finalize)
    llm/  routers/  tools/  guards/  terns/  run/  pause/  finops/  eval/  tracing/  prompts/  types/
    loader/, describe/   loadWorkflow (tsx) and describeWorkflow; studio.ts (LangGraph Studio)
    internal.ts     `graphcompose/internal`: what the CLI is built on — not public, not for projects
  tests/            unit tests (helpers.ts = fakes; fixtures/ = test workflows); routers/ alone; smoke/ = real
  schema/           profile.schema.json (YAML autocomplete)
packages/graphcompose-cli/    the `gc` / `graphcompose` command (#205; depends on graphcompose, same version)
  src/
    cli/            main.ts → run-cli.ts (argv → exit code 0/1/2 usage/3 project/4 conflict, --json
                    envelope), commands.ts (one option schema per command: parser + help), terminal helpers
    scaffold/       `gc create` / `gc generate` (templates/ next to src/)
    migrate/        `gc migrate imports` (#195): rewrites the old entries' imports to the new ones
    chat.ts, cli.ts, check.ts, describe.ts, rag-index.ts, eval/   command handlers
  tests/            CLI tests; workflows come from the framework's tests/fixtures
  bin/              the CLI launcher (bin names `gc` and `graphcompose`)
examples/job-scout/          the example (package job-scout-example; depends on graphcompose)
  src/              job-scout.workflow.ts, studio.ts; workflow-starts/ (*.workflow-start.ts), routers/
                    (*.router.ts), agents/ (*.agent.ts + *.prompt.md), workflow-finishes/
                    (*.workflow-finish.ts), tools/ (*.tool.ts +
                    *.dto.ts), services/ (*.service.ts), mcp/ (*.server.ts, *.mcp.ts, *.dto.ts),
                    rag/ (*.rag.ts), helpers/ (*.helper.ts), config/, scripts/, data/
  tests/  profiles/  golden/
scripts/        the gate's checks (check-root, check-suppressions, check-docs + docs/, api-report,
                public-entries, eslint-run-state), bootstrap-repo, bootstrap-labels, ticket, wiki,
                langfuse, coverage-badge
../<repo>.wiki  GitHub Wiki working copy (separate git repo, never inside this repo)
```

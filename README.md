# GraphCompose

[![CI](https://github.com/agbossjs/agboss/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/agbossjs/agboss/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/agbossjs/agboss/badges/coverage.json)](https://github.com/agbossjs/agboss/actions/workflows/ci.yml)

Typed agent workflows on LangGraph, in TypeScript. Agents, tools, MCP servers and knowledge bases
are **Angular-style components** — annotated classes, wired by a `@Workflow` module, dependencies
through the constructor, every link checked by the compiler. Routing and judging by decision models
(Jev, GPT-6 Luna Decisions, … — calibrated, exact cost),
FinOps on every call, Terns and evaluation, profiles and comparisons, tracing.

## Use it

```bash
npx -p graphcompose-cli gc create my-agents   # alias gc c — a project from a short questionnaire
cd my-agents && cp .env.example .env && npm run chat
npx gc g tool refund --workflow src/my-agents/my-agents.workflow.ts --agent assistant
# one tool per OpenAPI 3 operation (DTOs, a client in services/, tests), wired into the agent
npx gc g openapi pets --url ./pets.yaml --workflow src/my-agents/my-agents.workflow.ts --agent assistant
# any layout: targets come from the workflow module, tests go where vitest looks, files are
# prettier-formatted; a rerun refuses — --force regenerates the files and keeps the wiring in them
# (tools, rag, MCP, judges, routes, …); --force --reset starts them over without it
```

Or add it to a project and write the components yourself:

```bash
npm i graphcompose
npm i -D graphcompose-cli   # the CLI (`gc`)
```

<!-- snippet-context
import type { ToolHandler } from "graphcompose";
declare class GreenhouseJobs implements ToolHandler<never, unknown> {
  run(input: never): Promise<unknown>;
}
declare class ChatWorkflowStart {}
declare class MainRouter {}
declare class Profiler {}
declare class JobFitJudge {}
-->

```ts
// src/agents/scout.agent.ts — the prompt is a file next to the agent
import { Agent } from "graphcompose";

@Agent({
  name: "scout",
  description: "Finds jobs",
  promptUrls: ["./scout.prompt.md"],
  model: "moonshotai/kimi-k2.6",
  tools: [GreenhouseJobs],
})
export class Scout {}

// src/job-scout.workflow.ts — the graph, defaults and providers; limits in settings()
import { Workflow, WorkflowSettings, from, type WorkflowDefinition } from "graphcompose";
import { usd } from "graphcompose/units";

@Workflow({
  name: "job-scout",
  version: "1.0.0",
  flow: [
    from(ChatWorkflowStart).next(MainRouter),
    from(MainRouter).routes(), // the router's @Router({ routes }) targets
    from(Profiler, Scout).next(MainRouter),
  ],
  defaults: {
    models: { temperature: 0 },
    router: { kind: "jev", model: "typesafe/jev-1.13" },
    tools: { maxToolCalls: 8 },
    history: { limit: 5 },
  },
  providers: [JobFitJudge],
})
export class JobScout implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder()
      .limits({ perRun: { steps: 12, cost: usd(0.1) }, perDay: { cost: usd(1) } })
      .build();
  }
}
```

The whole shape — DTOs, a service, a tool, an agent, a router, the workflow and its test — is the
worked example in [`CLAUDE.md`](CLAUDE.md) → Architecture (compiled and run by `make check`).

```bash
npx graphcompose chat --workflow src/job-scout.workflow.ts
npx graphcompose describe --workflow src/job-scout.workflow.ts   # agents, tools, dependencies — no API key
npx graphcompose --help                                          # run, eval, replay, golden, compare, rag:index
```

Needs `OPENROUTER_API_KEY` in `.env`. Docs: [Wiki → Components](https://github.com/agbossjs/agboss/wiki/Components) ·
[Configuration](https://github.com/agbossjs/agboss/wiki/Configuration) · [Knowledge bases](https://github.com/agbossjs/agboss/wiki/Knowledge-bases) ·
[Profiles and comparisons](https://github.com/agbossjs/agboss/wiki/Profiles-and-comparisons).

## The example

[`examples/job-scout`](examples/job-scout) — resume → proposed search brief → Greenhouse jobs ranked
by Jev. It depends on `graphcompose` exactly like your project would:

```bash
npm install && npm run build          # at the repo root
cd examples/job-scout && npm run chat # "my resume src/data/sample-resume.md"
```

More: [Wiki → Example](https://github.com/agbossjs/agboss/wiki/Example).

## Public entries

One package; the root `graphcompose` is the authoring API, the rest are focused entries:

- `graphcompose` — `@Workflow`, `@Agent`, `@Router`, `@Tool`, `@Injectable`, `@WorkflowAction`,
  `@WorkflowStart` / `@WorkflowFinish`, `@Judge`, `@Guardrail`, `@PiiPolicy`, `@Channel`,
  `InjectionToken`, `provide`, `ENV`, `defineEnvironment`, `fromEnv`, `from`, `chain`,
  `WorkflowSettings`, `createApp`, `Decision`, observers, errors and types
- `graphcompose/dto` — field decorators (`@Text`, `@ListOf`, …) and the standard DTOs
- `graphcompose/units` — `usd()`, `seconds()`, `minutes()`
- `graphcompose/models` — model providers
- `graphcompose/testing` — `testWith`, `replyWith`, `mcpOf`, VCR (+ `graphcompose/testing/setup`)
- `graphcompose/mcp`, `/rag`, `/a2a`, `/memory` — integrations (`@McpServer`, `@McpTool`,
  `@McpExpose`, `@Rag`, A2A, memory)

Importing `graphcompose` has no side effects: tracing, the MCP SDK and SQLite load only when an app
uses them. The old entries `graphcompose/core`, `/graph`, `/router`, `/tool`, `/channels` and
`/concurrency` are deprecated re-exports for one minor release; `gc migrate imports` rewrites them
(and the renamed `Router` engine type → `RouterEngine`, root `McpServer` → `McpExpose` from
`graphcompose/mcp`, testing `Duration` → `ClockDuration`). Every entry's surface is in
`packages/graphcompose/api/*.api.md`; `npm run api:update` after an intended API change.

## Repository

```
packages/graphcompose/   the framework (published as `graphcompose`)
examples/job-scout/     the example (uses only the public API)
```

`make check` — build, API reports, compiled docs, format, lint, types, tests with coverage for both packages. `npm run dev` —
rebuild the framework on change. The framework never imports the examples, and the examples use
only `graphcompose` — both enforced by ESLint.

## Environments

Angular-style environment files, next to the workflow file in `environments/`. The workflow itself
says nothing about them.

```ts
// src/environments/environment.ts — the contract: which fields every environment has
declare module "graphcompose" {
  interface Environment {
    readonly apiUrl: string;
    readonly apiKey: string;
    readonly currency: string;
  }
}
export {};
```

```ts
// src/environments/dev.environment.ts — one file per environment: dev, staging, test, …
import { defineEnvironment, fromEnv } from "graphcompose";

export default defineEnvironment({
  apiUrl: "https://api.example.com", // a value in the file
  apiKey: fromEnv("API_KEY", { secret: true }), // a process variable, masked when printed
  currency: fromEnv("CURRENCY", { default: "USD" }), // a process variable with a default
});
```

`defineEnvironment` is typed by `Environment`: a missing or mistyped field is a `tsc` error in that
file. Services inject the values with the framework's `ENV` token:

```ts
import { ENV, Injectable, type Environment } from "graphcompose";

@Injectable({ deps: [ENV] })
export class Api {
  constructor(private readonly env: Environment) {}
}
```

- `gc chat --workflow src/app.workflow.ts` loads `dev`; `--env staging` loads
  `staging.environment.ts` (every workflow command takes `--env`). An unknown name fails at once
  (exit 3) listing the available ones; a `fromEnv` variable without a value or default fails the
  start naming every missing variable. `gc check` validates the selected environment without
  running anything, creating every component the start creates (tools, observers, judges, …), so it
  fails exactly when the start would; `gc describe` shows it with secrets masked.
- From code: `createApp(Workflow, { env: "staging" })`. In tests: `testWith(Workflow, { env: "test" })`
  or `testWith(Workflow, { environment: { … } })` (typed by `Environment`).
- A service injecting `ENV` in a workflow without `environments/` fails at start with
  `[di.missing-environment]`.
- Model provider keys are not part of it: they stay process variables (`EnvironmentVariable.named`).

## Quality gates (judges)

`@Agent({ judges: [AnswerGrounded], maxRetries: 1 })` runs every judge on the agent's reply. A judge
is a `@Judge({ name, model, deps })` class implementing `JudgeHandler`; the container creates it with
its `deps`, and its **own** model is called through the model gateway, so its spend is in the run's
cost report (`judge:<name>`, category `review`). A rejected reply goes back to the agent with the
feedback; once `maxRetries` retries are spent the run throws `QualityGateError`
(`code: "step.agent.quality-gate"`, `feedback` per judge). A judge without a model fails at app start
(`[judge.no-model]`).

The judge's model is a chat model (`ctx.model.invoke(...)`) or a **decision model**
(`ctx.model.decide({ state, questions })`) — every model of OpenRouter's Decisions API:
`typesafe/jev-1.13`, `openai/gpt-6-luna-decisions`, `perplexity/pplx-decider-v1(.1)-27b`,
`cloudflare/clef(-flash|-omni)`, `upstage/solar-decide`, `inception/mercury-decide`
(`DECISION_MODELS`; `DecisionsModelProvider` serves them, `JevModelProvider` is its deprecated alias).
Questions come from `Decision.noul` (yes/no → `noul` = P(yes)), `Decision.choice` (→ `choice`,
`probabilities`, `confidence`) and `Decision.score` (levels lowest first → `score` = the level's index);
the answers are typed by them. `state` is a text, a JSON object, or text and image parts
(`Decision.image(dataUrl)` — png/jpeg/webp data URLs; Luna, pplx-decider and Clef read images). At
most 200 questions per call; an answer that does not fit its question fails with
`model.decision.invalid-response`. `decide` on a chat model or `invoke` on a decision model throws
`ModelKindError` (`model.wrong-kind`).

<!-- snippet-context
import { InjectionToken } from "graphcompose";
interface JobSearch {
  lastResults(): readonly string[];
}
const JOB_SEARCH = new InjectionToken<JobSearch>("JOB_SEARCH");
-->

```ts
import { Decision, Judge, type JudgeContext, type JudgeHandler } from "graphcompose";

@Judge({ name: "answer-grounded", model: "openai/gpt-6-luna-decisions", deps: [JOB_SEARCH] })
export class AnswerGrounded implements JudgeHandler {
  constructor(private readonly search: JobSearch) {}
  async judge(reply: string, ctx: JudgeContext) {
    const a = await ctx.model.decide({
      state: { task: ctx.task, reply, results: this.search.lastResults() },
      questions: {
        grounded: Decision.noul("Every fact in the reply appears in the results"),
        tone: Decision.choice("Tone of the reply", {
          neutral: "Plain, factual",
          pushy: "Sells or pressures",
        }),
        quality: Decision.score("Overall usefulness", ["useless", "partial", "complete"]),
      },
    });
    // a.grounded.noul: number; a.tone.choice: "neutral" | "pushy"; a.quality.score: number
    return a.grounded.noul > 0.7 && a.tone.choice === "neutral"
      ? { passed: true }
      : { passed: false, feedback: "Only state facts from the search results, neutrally." };
  }
}
```

In tests, script a chat judge like an agent — `mockLlm(Judge).thenReturn(replyWith("PASS"))` — and a
decision judge with its answers by question id (an option, P(yes), a level's index or text):
`mockLlm(AnswerGrounded).thenReturn(decideWith({ grounded: 0.9, tone: "neutral", quality: 2 }, { cost: usd(0.0002) }))`.

Routers and guards work on any decision model too (`@Router({ model: "openai/gpt-6-luna-decisions" })`):
one choice question over the routes, options sorted so declaration order never changes the request.

## Run Context & Observers

Every tool and action gets the run it is part of as `ctx.run` (`RunContext`): built once per
`execute` / `resume`, the same for every node of the run. One run has one id: its observer events,
`ctx.run.runId`, its Tern (`Tern.runId`), its trace and its result (`ExecutionOutput.runId`) carry
the same one, also after a resume. Prompts read the start's input as `{{input.<field>}}`
(`"Return at most {{input.limit}} jobs."`): a field none of the workflow's starts has fails assembly
(`[prompt.unknown-variable]`); where the starts are not known (an open input DTO) a field the run's
input lacks renders empty, with a `prompt.missing-input-field` warning.

<!-- snippet-context
import { WorkflowAction, type ActionContext } from "graphcompose";
@WorkflowAction({ name: "pay", description: "Pays the order" })
export class Pay {
// @snippet
}
-->

```ts
execute(_state: unknown, ctx: ActionContext) {
  ctx.run.runId; // RunId, unique per run, the same after a resume (= ExecutionOutput.runId)
  ctx.run.threadId; // the conversation (ExecutionOutput.thread)
  ctx.run.signal; // aborted by app.cancel(thread) or the caller's signal
  ctx.run.metadata; // from execute(…, { metadata }), kept by the run's resumes
  ctx.run.owner; // from execute(…, { owner }): who the thread belongs to
  ctx.run.input; // the start's whole validated input ({ text, limit, … }), kept by the run's resumes
  ctx.idempotencyKey; // `${runId}:${node}` (+ `:${index}` inside batchParallel)
  return {};
}
```

<!-- snippet-context
import type { App, WorkflowStartClass } from "graphcompose";
declare const app: App;
declare const Start: WorkflowStartClass;
declare const thread: string;
declare const userId: string;
declare const signal: AbortSignal;
-->

```ts
await app.execute(
  Start,
  { text: "Pay order 7" },
  { thread, owner: userId, signal, metadata: { tenant: "acme" } },
);
const { cancelled } = await app.cancel(thread, { owner: userId });
```

A thread created with an `owner` belongs to it: `execute` on that thread, `resume` and `cancel`
with another owner (or none) throw `ThreadOwnerError` (`run.thread-owner`) before anything runs or
is read. Tool arguments a channel shows (and `ExecutionOutput.pause.args`) have the input DTO's
`sensitive` fields masked as `***`; the tool itself still gets them whole.

Each run reserves its `limits.perRun.cost` of the day before its first model call, so concurrent
runs never jointly pass `limits.perDay.cost`; a workflow that sets `perDay.cost` without
`perRun.cost` fails at start with `[limits.per-run-required]`.

`execute` and `resume` forward `signal`, `metadata`, `onStream` (token and tool-call events) and
`configurable` (extra LangGraph keys; the framework's own win). `app.cancel(thread)` aborts a running
run — it stops before its next model or tool call and `execute` rejects with
`WorkflowCancelledError` — or drops a paused one, whose `resume` then throws `NotPausedError`;
`cancelled` is `false` when the thread had neither. In unit tests, `testRunContext()` from
`graphcompose/testing` builds a `ctx.run`.

Observers see a run's workflow, agent, router, tool, model, guardrail, policy, action, channel and
judge start/end events. `onWorkflowStart` fires once per run (at `execute`); a run that pauses emits
`onWorkflowPause` (`event.pause`: what it waits for), `app.resume` emits `onWorkflowResume`
(`event.decision`), and `onWorkflowEnd` / `onError` fire when the run finishes or fails — also
after a resume; cancelling a paused run is an `onError` with `WorkflowCancelledError`. Every event
carries the run's one `runId` and its real `threadId`. A request refused before a run starts or is
located — another owner's thread, a `resume` with nothing paused, an `execute` on an unknown thread
or with an invalid start input — emits `onRunRejected` (`operation`, `threadId` when given, the
error's stable `code`, a `message` without the input values; never a `runId`) and still throws. A
resume refused as incompatible after a deploy (`IncompatibleResumeError`) is an `onError` on the
paused run, with its `runId` and thread; the run stays paused. Only classes listed in `@Workflow({ observers: [...] })` are called; the
container creates them at app start, with their `deps`. Each hook has its own interface and payload
type; assembly rejects an observer with no hook or with a misspelled one (`did you mean onToolEnd?`).
An observer that throws is reported as a process warning and never fails the run.

<!-- snippet-context
import type { AgentsConfig, Flow } from "graphcompose";
declare const flow: Flow;
declare const defaults: AgentsConfig["defaults"];
-->

```ts
import {
  Injectable,
  Workflow,
  WorkflowSettings,
  type WorkflowDefinition,
  type AppState,
  type AgentStartEvent,
  type OnAgentStart,
  type OnRunRejected,
  type OnWorkflowStart,
  type RunRejectedEvent,
} from "graphcompose";

@Injectable()
export class MetricsObserver implements OnWorkflowStart, OnAgentStart, OnRunRejected {
  onWorkflowStart(state: AppState) {
    console.log(`Run ${state.runId} started`);
  }
  onAgentStart(event: AgentStartEvent) {
    console.log(`Agent ${event.name} started in run ${event.state.runId}`);
  }
  onRunRejected(event: RunRejectedEvent) {
    console.log(`${event.operation} refused: ${event.code}`);
  }
}

@Workflow({ name: "support", version: "1.0.0", flow, defaults, observers: [MetricsObserver] })
export class SupportWorkflow implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder().build();
  }
}
```

## Tracing (local, optional)

```bash
scripts/langfuse.sh up   # self-hosted Langfuse in Docker, keys written to .env
```

Then every run is traced at http://localhost:3000. Details: [Wiki → Tracing](https://github.com/agbossjs/agboss/wiki/Tracing).

## The conveyor

Tickets move across the GitHub Project board of the repo:

| Stage              | Skill          | Result                                                                                                |
| ------------------ | -------------- | ----------------------------------------------------------------------------------------------------- |
| Triage             | `triage`       | business side clarified through quizzes; issue(s) created or updated, split into sub-issues if needed |
| Backlog            | `spec-session` | spec, implementation plan, automated + manual acceptance criteria — in the issue                      |
| In progress → Test | `implement`    | independent issues in parallel; branch + PR per issue, merged to `main`; manual-test handoff          |
| Done               | a human        | after manual acceptance                                                                               |

Rules and the delivery pipeline: [`WORKFLOW.md`](WORKFLOW.md) · [`QUALITY.md`](QUALITY.md) ·
[`CLAUDE.md`](CLAUDE.md). Specs and plans live in GitHub Issues, docs in the GitHub Wiki.

## License

MIT — see [`LICENSE`](LICENSE).

# Configuration

Set in the workflow's components ([Components](Components)): workflow-wide fields in `@Workflow`,
limits and model providers in its `settings()`, agent fields in each `@Agent`, router fields in each
`@Router`. Assembled and validated at startup; [profiles](Profiles-and-comparisons) override them
without code. Secrets are never there — model provider keys are process variables
(`OPENROUTER_API_KEY` in `.env`), the app's own settings live in [environments](#environments).

<!-- snippet-context
import { Workflow, WorkflowSettings, chain, type WorkflowDefinition } from "agboss";
import { DecisionsModelProvider, OpenRouterModelProvider } from "agboss/models";
import { usd } from "agboss/units";
declare class ChatWorkflowStart {}
declare class ScoutAgent {}
declare class ChatWorkflowFinish {}
declare class ShortlistServer {}
-->

```ts
@Workflow({
  name: "job-scout", // lowercase, digits, dashes — the key of the daily spend ledger
  version: "2.0.0", // labels every run; profiles set their own
  flow: [chain(ChatWorkflowStart, ScoutAgent, ChatWorkflowFinish)],
  defaults: {
    models: { temperature: 0 }, // every chat model (agents, LLM routers)
    router: { kind: "jev", model: "typesafe/jev-1.13" }, // guards, tools' decisions
    tools: { maxToolCalls: 8 },
    history: { limit: 5 },
  },
  guards: {
    input: { prompt_injection: { threshold: 0.7, refusal: "I can't help with that request." } },
  },
  compaction: { every: 5, keep: 10, model: { model: "moonshotai/kimi-k2.6", thinking: "none" } },
  mcp: [ShortlistServer],
  promptVariables: { boards: "acme (Acme)" },
})
export class JobScout implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder()
      .limits({ perRun: { steps: 12, cost: usd(0.1) }, perDay: { cost: usd(1) } })
      .modelProviders([OpenRouterModelProvider, DecisionsModelProvider])
      .build();
  }
}
```

## `defaults.models` — applied to every chat model (agents and LLM routers)

| Field         | Values                                                                                                                                                       | Default        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| `temperature` | 0–2                                                                                                                                                          | required       |
| `maxTokens`   | positive int, or `MODEL_MAX` (`"max"`) for no ceiling — set explicitly                                                                                       | `8192`         |
| `thinking`    | override of the provider's reasoning: `"default"` (model decides) · `"none"` (off) · `"minimal"`…`"xhigh"` · `{ budgetTokens: n }` · a `Reasoning` value | the provider's |
| `cache`       | override of the provider's caching: `true` = the provider's · `false` = off · a `PromptCaching` value                                                       | the provider's |

Timeouts, retries, circuit breakers, request fields (e.g. OpenRouter's `provider: { ignore: [...] }`)
and costs belong to the **model provider** — see [Model providers](Model-providers); `price` on an
agent is an optional override of the provider's price table. Every setting is checked against its
model at startup and by `agboss check --models`.

## `defaults.tools`

| Field          | Meaning                                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxToolCalls` | optional: tool calls per call of an agent (`agents.<name>.limits.toolCalls`, default 20); crossing it fails the run — see [Agents](Agents#limits-per-call-of-the-agent) |

## `defaults.history`

| Field       | Meaning                                                                   |
| ----------- | ------------------------------------------------------------------------- |
| `limit`     | how many previous Terns of the thread routers and agents see              |
| `summaries` | how many latest compaction summaries they see (default `compaction.keep`) |

Per agent: `@Agent({ historyLimit, historySummaries })`, or a `memoryStrategy`
([Memory Management](Memory-Management)).

## `defaults.router` — the model for guards and components' decisions

`{ kind: "jev", model: "typesafe/jev-1.13" }` or `{ kind: "llm", model, … }`. Flow routers
(`@Router`) name their own `model` — see [Routers](Routers).

## Limits — `settings().limits(...)`

`perRun: { steps, cost }` and `perDay: { cost }` (values with units: `usd()` from
`agboss/units`). Steps = visits of agents and routers (default (agents + routers) × 3). Hitting
one **fails the run** with `LimitExceededError` naming the key (`limits.perRun.steps`,
`limits.perRun.cost`, `limits.perDay.cost`, `routers.<name>.maxVisits`). `perDay.cost` requires
`perRun.cost` (`[limits.per-run-required]`). Details: [FinOps](FinOps).

## `mcp` — `@McpServer` classes

| Transport | Fields                                                                        |
| --------- | ------------------------------------------------------------------------------ |
| `stdio`   | `command`, `args?`, `env?` — **names** of env variables passed to the process |
| `http`    | `url`, `headers?` — header → **name** of the env variable with its value      |

A used server that is missing, unreachable, lacks an env variable or has a drifted contract stops
startup. See [Mcp](Mcp).

## Agents

From `@Agent` classes: `model`, `description` (shown to routers), `prompt` / `promptUrls` /
`promptVariables`, `tools` (class references — a missing one does not compile), `maxToolCalls`,
`historyLimit`, `historySummaries`, `judges` + `maxRetries`, `rag`, `memoryStrategy`, `compensate`,
`price`, and any `defaults.models` field as an override.

## `guards`

Input and output guards: `threshold`, `refusal`, optional `model` per guard. See [Guards](Guards).

## `compaction` (optional)

`every` turns per summary (≥ 2), `keep` summaries readers see by default (the queue drops the oldest),
`model` — the model that writes them. Readers: `defaults.history.summaries`, per agent
`historySummaries` (0 = none); `historyLimit` caps the raw turns since the last compaction. A workflow
may override the prompt (`compactionPrompt`). See
[Terns and evaluation](Terns-and-evaluation#conversation-memory-compaction).

## Environments

The app's settings live in `environments/` next to the workflow file — the workflow itself says
nothing about them. The contract is a module augmentation:

```ts
// src/environments/environment.ts — which fields every environment has
declare module "agboss" {
  interface Environment {
    readonly apiUrl: string;
    readonly apiKey: string;
  }
}
export {};
```

```ts
// src/environments/dev.environment.ts — one file per environment: dev, staging, test, …
import { defineEnvironment, fromEnv } from "agboss";

export default defineEnvironment({
  apiUrl: "https://api.example.com", // a value in the file
  apiKey: fromEnv("API_KEY", { secret: true }), // a process variable, masked when printed
});
```

Services inject the values with the `ENV` token, never `process.env`:

```ts
import { ENV, Injectable, type Environment } from "agboss";

@Injectable({ deps: [ENV] })
export class Api {
  constructor(private readonly env: Environment) {}
}
```

`--env <name>` (every workflow command), `createApp(W, { env })` and
`testWith(W, { env | environment })` pick one (default `dev`); an unknown name or a `fromEnv` variable
without a value or default fails at start, naming it. `agboss check` validates the selected environment,
`agboss describe` shows it with secrets masked.

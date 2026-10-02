# Configuration

Set in the workflow's components ([Components](Components)): workflow-wide fields in `@Workflow`, agent
fields in each `@Agent`; assembled and validated with zod at startup (`validateAgentsConfig`).
Profiles override them without code ([Profiles](Profiles-and-comparisons)). Secrets are never there — only `OPENROUTER_API_KEY` in `.env`.

## `defaults.chat` — applied to every chat model (agents and LLM routers)

| Field         | Values                                                                            | Default     |
| ------------- | --------------------------------------------------------------------------------- | ----------- |
| `temperature` | 0–2                                                                               | `0`         |
| `maxTokens`   | positive int, or `MODEL_MAX` (`"max"`) for no ceiling — set explicitly            | `8192`      |
| `thinking`    | optional override of the provider's reasoning: `"default"` (model decides) · `"none"` (off) · `"minimal"`…`"xhigh"` · `{ budgetTokens: n }` · a `Reasoning` value | the provider's |
| `cache`       | optional override of the provider's caching: `true` = the provider's · `false` = off · a `PromptCaching` value | the provider's |

Timeouts, retries, circuit breakers, request fields (e.g. OpenRouter's `provider: { ignore: [...] }`)
and costs are the **model provider's** since #151 — `timeoutMs`, `maxRetries`, `provider` and the
required per-model `price` are gone (`price` stays as an optional override of the provider's price
table). See [Model providers](Model-providers); every setting is checked against its model at
startup and by `gc check --models`.

## `defaults.tools`

| Field          | Meaning                                                               |
| -------------- | --------------------------------------------------------------------- |
| `maxToolCalls` | optional: tool calls per call of an agent (`agents.<name>.limits.toolCalls`, default 20); crossing it fails the run — see [Agents](Agents#limits-per-call-of-the-agent) |

## `version`

Readable config version (e.g. `1.0.0`) — labels every run; profiles set their own. See
[Profiles and comparisons](Profiles-and-comparisons).

## `defaults.history`

| Field   | Meaning                                                                    |
| ------- | -------------------------------------------------------------------------- |
| `limit` | how many previous Terns of the thread routers and agents see (template: 5) |

Override per agent (`historyLimit`). Routers read the defaults.

## `defaults.router` — model for guards, judges and tools' decisions

Default: `{ kind: "jev", model: "typesafe/jev-1.13" }`. Flow routers (`@Router`) name their own
`model` — see [Routers](Routers).

## Flow and limits (no `routers`, no `budget` — #116)

The graph is `@Workflow({ flow })` and the limits come from the class's `settings()`:

```ts
@Workflow({ name: "job-scout", version: "2.0.0", flow: [ … ], defaults, guards, … })
export class JobScout implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder()
      .limits({ perRun: { steps: 12, cost: usd(0.1) }, perDay: { cost: usd(1) } })
      .build();
  }
}
```

Was: `routers: { main: { maxHops } }` → `@Router({ maxVisits })`; `budget.runBudgetCap` →
`limits.perRun.cost`; `budget.dailyBudgetCap` → `limits.perDay.cost`; `budget.evalBudgetCap` → eval
pays from its own account with the same daily cap. Details: [Workflow](Workflow), [FinOps](FinOps).

## `mcpServers` (from `@McpServer` classes)

MCP servers declared with `@McpServer` — see [Tools](Tools).

| Transport | Fields                                                                        |
| --------- | ----------------------------------------------------------------------------- |
| `stdio`   | `command`, `args?`, `env?` — **names** of env variables passed to the process |
| `http`    | `url`, `headers?` — header → **name** of the env variable with its value      |

A used server that is missing, unreachable, lacks an env variable or has a drifted contract stops startup.

## `agents`

From `@Agent` classes: `model`, `description` (shown to routers), `price` (optional — the provider prices calls), `tools` (class references —
a missing one does not compile), `maxToolCalls`, and any `defaults.chat` field as an override. The
prompt is `<agent>.prompt.md` next to the agent class.

## `guards`

Input and output guards: `threshold`, `refusal`, optional `model` per guard; texts in
`src/prompts/guards.ts`. See [Guards](Guards).

## `name`

Agent workflow id (lowercase, digits, dashes). Key of the daily spend ledger.

## `compaction` (optional)

```ts
compaction: {
  every: 5,   // turns per summary (≥ 2)
  keep: 10,   // summaries readers see by default; the queue drops the oldest (FIFO)
  model: { model: "moonshotai/kimi-k2.6", thinking: "none" },
}
```

Readers: `defaults.history.summaries` (default `keep`; routers read it), per agent
`historySummaries` (0 = none); `historyLimit` caps the raw turns since the last
compaction. Prompt: `src/prompts/compaction.ts`, a workflow may override (`compactionPrompt`). See
[Terns and evaluation](Terns-and-evaluation#conversation-memory-compaction).

## Limits

`settings().limits(…)` — see [Flow and limits](#flow-and-limits-no-routers-no-budget--116) and
[Workflow](Workflow). Details: [FinOps](FinOps).

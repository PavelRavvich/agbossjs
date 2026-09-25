# Configuration

Single file: `src/config/agents.config.ts`, validated with zod at startup
(`validateAgentsConfig`). Secrets are never there — only `OPENROUTER_API_KEY` in `.env`.

## `defaults.chat` — applied to every chat model (agents and LLM routers)

| Field         | Values                                                          | Default     |
| ------------- | --------------------------------------------------------------- | ----------- |
| `temperature` | 0–2                                                             | `0`         |
| `maxTokens`   | positive int or `MODEL_MAX` (`"max"`) — no cap, model's maximum | `MODEL_MAX` |
| `thinking`    | `"default"` · `"none"`…`"xhigh"` · `{ budgetTokens: n }`        | `"default"` |
| `cache`       | prompt caching where the model supports it                      | `true`      |

- `thinking` maps to OpenRouter `reasoning` (`effort` or `max_tokens`); thoughts are excluded from
  the response but billed as output. Some models reject `"none"`.
- `cache`: OpenAI, DeepSeek, Moonshot (Kimi), Grok cache automatically; Anthropic and Google need
  explicit breakpoints — the system prompt is marked with `cache_control`.

## `defaults.tools`

| Field          | Meaning                                                               |
| -------------- | --------------------------------------------------------------------- |
| `maxToolCalls` | default tool call limit of an agent's loop; crossing it fails the run |

## `defaults.history`

| Field   | Meaning                                                                    |
| ------- | -------------------------------------------------------------------------- |
| `limit` | how many previous Terns of the thread routers and agents see (template: 5) |

Override per agent (`historyLimit`) and per router (`routers.<name>.historyLimit`).

## `defaults.router` — model for every router that does not set its own

Default: `{ kind: "jev", model: "typesafe/jev-1.13" }`.

## `routers`

```ts
routers: {
  main: { maxHops: 3 },                                   // uses defaults.router (Jev)
  // main: { maxHops: 3, model: { kind: "llm", model: "moonshotai/kimi-k2.6", price } },
}
```

`main` is required (the graph's router). Add more routers for new graphs.

## `mcpServers` (optional)

MCP servers used by facades in `src/tools/catalog.ts` — see [Tools](Tools).

| Transport | Fields                                                                        |
| --------- | ----------------------------------------------------------------------------- |
| `stdio`   | `command`, `args?`, `env?` — **names** of env variables passed to the process |
| `http`    | `url`, `headers?` — header → **name** of the env variable with its value      |

A used server that is missing, unreachable, lacks an env variable or has a drifted contract stops startup.

## `agents`

`model`, `description` (shown to routers), `price`, `tools` (names from the tool registry — typos do not compile), `maxToolCalls`, and any `defaults.chat` field as an override.
A new agent needs a prompt in `src/prompts/agents.ts`, otherwise it does not compile.

## `guards`

Input and output guards: `threshold`, `refusal`, optional `model` per guard; texts in
`src/prompts/guards.ts`. See [Guards](Guards).

## `name`

Agent bundle id (lowercase, digits, dashes). Key of the daily spend ledger.

## `compaction` (optional)

```ts
compaction: {
  every: 5,   // turns per summary (≥ 2)
  keep: 10,   // summaries readers see by default; the queue drops the oldest (FIFO)
  model: { model: "moonshotai/kimi-k2.6", thinking: "none", price: … },
}
```

Readers: `defaults.history.summaries` (default `keep`), per agent `historySummaries`, router
`routers.main.historySummaries` (0 = none); `historyLimit` caps the raw turns since the last
compaction. Prompt: `src/prompts/compaction.ts`, a bundle may override (`compactionPrompt`). See
[Terns and evaluation](Terns-and-evaluation#conversation-memory-compaction).

## `agents.<name>.reasoning` (optional)

```ts
reasoning: {
  threshold: 0.8,                      // return an attempt as soon as Jev's P(good) reaches this
  maxAttempts: 3,                      // including the first
  thinking: ["low", "medium", "high"], // per attempt; shorter than maxAttempts → the last level repeats
  onExhausted: "best",                 // "best" (default when omitted) | "last" | "fail"
  criteria: ["…"],                     // optional feedback criteria; default: correct / complete / usable
  model: …,                            // optional judge model; default defaults.router (Jev)
}
```

After each attempt a judge (Jev) answers _is this answer good enough for the task?_ — its P(good)
is the attempt's score. At or above `threshold` the attempt is returned at once. Otherwise, while
attempts and the run budget last, Jev checks the criteria, and the next attempt (next thinking
level) sees its previous answer and what fell short. Attempts exhausted: `best` returns the
highest-scored attempt, `last` the last one, `fail` fails the run with `QualityNotReachedError`
(best score in the message; spend recorded). Only the returned attempt is in the route; all attempts
with scores are in `result.attempts` and the Tern; under the answer:
`coder attempts: 0.62 → 0.74 → 0.79 · returned #3 (best)`. Template example: `coder`.
Decision: [ADR-0006](ADR-0006-Quality-gated-reasoning-attempts).

## `budget`

| Field            | Meaning                                                       |
| ---------------- | ------------------------------------------------------------- |
| `runBudgetCap`   | USD one run may spend                                         |
| `dailyBudgetCap` | USD this bundle may spend per UTC day, resets 00:00 UTC       |
| `evalBudgetCap`  | USD per UTC day for eval and replay (account `<bundle>:eval`) |

Details: [FinOps](FinOps).

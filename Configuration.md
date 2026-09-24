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

## `agents`

`model`, `description` (shown to routers), `price`, and any `defaults.chat` field as an override.
A new agent needs a prompt in `src/prompts/agents.ts`, otherwise it does not compile.

## `name`

Agent bundle id (lowercase, digits, dashes). Key of the daily spend ledger.

## `budget`

| Field            | Meaning                                                 |
| ---------------- | ------------------------------------------------------- |
| `runBudgetCap`   | USD one run may spend                                   |
| `dailyBudgetCap` | USD this bundle may spend per UTC day, resets 00:00 UTC |

Details: [FinOps](FinOps).

# FinOps

## Measure

- **Every model call is accounted**: a `UsageRecord` (caller, model, input/output/cache tokens,
  USD, `costSource`) per call, accumulated in graph state.
- **Cost source**: Jev reports exact cost (`"api"`); chat models are priced from the config table
  (`"price-table"`): uncached input × input price + cache read/write × cache prices (fallback:
  input price) + output × output price.
- **Tool costs**: a paid tool reports its own cost with `ctx.reportCost(usd)`; it is recorded as
  `tool:<name>` (`costSource: "tool"`) in the same loop as the model calls — so it counts in the run
  budget check before the next model call, in the daily ledger and in a failed agent's spend. An
  invalid cost (negative, NaN) becomes a tool error the model sees.
- **Report**: every run returns `CostReport` (total, calls, cache-read tokens, per caller) and the
  budget it was allowed; the CLI prints it. Per-call traces: LangSmith via env.

## Limit — per agent bundle

The bundle is the config (`name`, e.g. `research-coder`); its caps live in `budget`:

| Field            | Meaning                                                        |
| ---------------- | -------------------------------------------------------------- |
| `runBudgetCap`   | USD one run may spend                                          |
| `dailyBudgetCap` | USD the bundle may spend per **UTC** day — resets at 00:00 UTC |

- **Ledger**: append-only JSONL outside the repo, one file per bundle per UTC day —
  `$SPEND_LEDGER_DIR/<bundle>/<YYYY-MM-DD>.jsonl` (default `~/.langgraph-agents/spend`). A new
  day means a new file, which is the reset.
- **Before a run**: run budget = `min(runBudgetCap, dailyBudgetCap − spent today)`; nothing left →
  `BudgetExceededError`, no calls made.
- **During a run**: every model call is written to the ledger as the graph streams. An agent that fails
  mid-loop (e.g. crossing `maxToolCalls`) carries its spend in `AgentFailedError`, and `runAgent`
  writes it to the ledger before rethrowing — failures are paid for too. The router stops the run when its budget is spent.
- **Soft by one call**: a call in flight cannot be stopped; parallel runs of one bundle can overshoot
  the daily cap by their in-flight calls. `MODEL_MAX` makes a single call bounded only by the model.
- `npm run studio` runs the graph directly and does not apply the daily cap.
- Optional extra backstop outside the app: a spending limit on the OpenRouter key itself.

## Turn financials — part of every result

Every `AgentRunResult` carries `cost` (`CostReport`) — the core always reports it; each client
decides what to show:

| Field                                  | Meaning                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `totalUsd`, `calls`, `cacheReadTokens` | the turn in total                                                             |
| `byCategory`                           | `agents`, `routing`, `guards`, `review`, `tools` — every key present          |
| `byModel`, `byCaller`                  | the same money by model and by caller                                         |
| `trace`                                | every call in order: caller, category, model, cost, how it was priced, tokens |

Categories come from the caller: `tool:*` → tools, `router:guard:*` → guards, `router:review:*` →
review, other `router:*` → routing, an agent name → agents. A resumed (paused) run reports the whole
run.

The CLI and the chat print it every turn:

```
researcher · stop: jev confidence 0.96
$0.003403 in 8 calls — agents $0.002332 · routing $0.000038 · guards $0.000033 · tools $0.001000
   1. router:guard:prompt_injection  typesafe/jev-1.13  $0.000014  api-priced
   2. router:main                    typesafe/jev-1.13  $0.000016  api-priced
   3. researcher                     kimi-k2.6          $0.000426  306 in / 116 out
   5. tool:exchange_rate             exchange_rate      $0.001000  tool-reported
   …
```

`api-priced` = exact price from the provider (Jev bills per decision); `N in / M out` = tokens ×
price table; `tool-reported` = the tool's own cost.

## Review spend

Every review call (`router:review:<agent>`) and every extra pass is billed and counted in the run
budget; no review or pass starts once the run budget is spent. Expensive thinking runs only when the
reviewer asks for it.

## Eval spend

`npm run eval` / `npm run replay` pay from `<bundle>:eval` with `evalBudgetCap` — they never eat the
production daily budget. See [Terns and evaluation](Terns-and-evaluation).

## Tests

Unit tests use fakes and cost $0; real calls only in `make smoke`.

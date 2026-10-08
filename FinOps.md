# FinOps

## Measure

- **Every model call is accounted**: a `UsageRecord` (caller, model, input/output/cache tokens,
  USD, `costSource`) per call, accumulated in graph state.
- **Cost source** — the call's [model provider](Model-providers#cost): a cost the provider reports
  in its replyWith (Jev, OpenRouter's `usage.cost`) is exact (`"api"`) and always comes first; else the
  provider's price table (`ModelCost.fromPrices`) or the component's own `price` (`"price-table"`):
  uncached input × input price + cache read/write × cache prices (fallback: input price) + output ×
  output price. A call with neither fails — never silently free.
- **Tool costs**: a paid tool reports its own cost with `ctx.reportCost(usd)`; it is recorded as
  `tool:<name>` (`costSource: "tool"`) in the same loop as the model calls — so it counts in the run
  budget check before the next model call, in the daily ledger and in a failed agent's spend. An
  invalid cost (negative, NaN) becomes a tool error the model sees.

```typescript
export class PaidTool implements ToolHandler<PaidInput, PaidOutput> {
  async run(input: PaidInput, ctx: ToolContext): Promise<PaidOutput> {
    ctx.reportCost(0.05); // $0.05 for this tool call
    return { success: true };
  }
}
```

- **Report**: every run returns `CostReport` (total, calls, cache-read tokens, per caller) and the
  budget it was allowed; the CLI prints it. Per-call traces: LangSmith via env.

## Limit — per workflow

The workflow's limits come from its `settings()` ([Workflow](Workflow)):

| Limit                    | Boundary key               | Meaning                                                          |
| ------------------------ | -------------------------- | ---------------------------------------------------------------- |
| `perRun.cost`            | `limits.perRun.cost`       | USD one run may spend                                            |
| `perDay.cost`            | `limits.perDay.cost`       | USD the workflow may spend per **UTC** day — resets at 00:00 UTC |
| `perRun.steps`           | `limits.perRun.steps`      | agent and router visits per run (default (agents + routers) × 3) |
| `@Router({ maxVisits })` | `routers.<name>.maxVisits` | visits of one router per run                                     |

- **Ledger**: append-only JSONL outside the repo, one file per workflow per UTC day —
  `$SPEND_LEDGER_DIR/<workflow>/<YYYY-MM-DD>.jsonl` (default `~/.langgraph-agents/spend`). A new
  day means a new file, which is the reset.
- **Before a run**: the day is read once; nothing left → `LimitExceededError` (`limits.perDay.cost`),
  no calls made. The run budget (`min(perRun.cost, perDay.cost − spent today)`) also stops an agent's
  loop before a model call it cannot afford.
- **During a run**: every model call is written to the ledger as the graph streams. Before each
  working node (agent, router) the limits are checked; crossing one **fails** the run with
  `LimitExceededError` (key, limit, actual, path, spend) — never a quiet stop — and the failed Tern
  carries the spend. A paid failure (an agent crossing `agents.<name>.limits.*`, a router that could not routeTo)
  carries its spend and `runAgent` writes it to the ledger before rethrowing — failures are paid for
  too. A paused run's spend is written at the pause.
- **Soft by one call**: a call in flight cannot be stopped; parallel runs of one workflow can overshoot
  the daily cap by their in-flight calls. `MODEL_MAX` makes a single call bounded only by the model.
- `npm run studio` runs the flow graph with the workflow's limits; the day's spend is read from the ledger.
- Optional extra backstop outside the app: a spending limit on the OpenRouter key itself.

## Turn financials — part of every result

Every `AgentRunResult` carries `cost` (`CostReport`) — the core always reports it; each client
decides what to show:

| Field                                  | Meaning                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `totalUsd`, `calls`, `cacheReadTokens` | the turn in total                                                                               |
| `byCategory`                           | `agents`, `routing`, `guards`, `review`, `tools`, `compaction`, `retrieval` — every key present |
| `byModel`, `byCaller`                  | the same money by model and by caller                                                           |
| `trace`                                | every call in order: caller, category, model, cost, how it was priced, tokens                   |

Categories come from the caller: `tool:*` → tools, `compaction` → compaction, `rag:*` → retrieval, `router:guard:*` → guards, `router:quality:*` →
review, other `router:*` → routing, an agent name → agents. A resumed (paused) run reports the whole
run.

The CLI and the chat print it every turn:

```
thread 6cc2173e-… · http://localhost:3000/project/…/sessions/6cc2173e-…
researcher · stop: jev confidence 0.96
agents $0.002332 · routing $0.000038 · guards $0.000033 · tools $0.001000
   1. router:guard:prompt_injection  typesafe/jev-1.13  $0.000014  api-priced
   2. router:main                    typesafe/jev-1.13  $0.000016  api-priced
   3. researcher                     kimi-k2.6          $0.000426  306 in / 116 out
   5. tool:exchange_rate             exchange_rate      $0.001000  tool-reported
   …
total $0.003403 (8 calls)
```

`api-priced` = exact price from the provider (Jev bills per decision); `N in / M out` = tokens ×
price table; `tool-reported` = the tool's own cost.

## Eval spend

`npm run eval` / `npm run replay` / `compare` pay from `<workflow>:eval` — its own day, capped at the
workflow's `limits.perDay.cost` (no cap when unset); they never eat the production day. See [Terns and evaluation](Terns-and-evaluation).

## Tests

Unit tests use fakes and cost $0; real calls only in `make smoke`.

# FinOps

## Measure

- **Every model call is accounted**: a `UsageRecord` (caller, model, input/output/cache tokens,
  USD, `costSource`) per call, accumulated in graph state.
- **Cost source**: Jev reports exact cost (`"api"`); chat models are priced from the config table
  (`"price-table"`): uncached input × input price + cache read/write × cache prices (fallback:
  input price) + output × output price.
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

## Tests

Unit tests use fakes and cost $0; real calls only in `make smoke`.

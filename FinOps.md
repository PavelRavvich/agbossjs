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

## Review spend

Every review call (`router:review:<agent>`) and every extra pass is billed and counted in the run
budget; no review or pass starts once the run budget is spent. Expensive thinking runs only when the
reviewer asks for it.

## Eval spend

`npm run eval` / `npm run replay` pay from `<bundle>:eval` with `evalBudgetCap` — they never eat the
production daily budget. See [Terns and evaluation](Terns-and-evaluation).

## Tests

Unit tests use fakes and cost $0; real calls only in `make smoke`.

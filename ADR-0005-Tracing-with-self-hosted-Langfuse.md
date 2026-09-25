# ADR-0005 — Tracing with self-hosted Langfuse

- **Status:** Accepted
- **Issue:** #59

## Context

We want to see each turn as a trace (graph steps, model calls with prompts and tokens, tool
calls). The default for LangGraph is LangSmith, which uploads all of that to a third-party cloud —
for `job-scout` that includes a resume.

## Decision

- Tracing goes to a **self-hosted Langfuse** (open source) started by `scripts/langfuse.sh`: ports
  bound to localhost, generated secrets, telemetry off.
- The core has optional `RunTracing` (LangChain callbacks); the Langfuse implementation uses an
  isolated OpenTelemetry tracer provider and is on only when `LANGFUSE_*` variables are set.
- Session = conversation thread, tag = bundle; Studio runs are traced with session `studio`.

## Consequences

- Traces stay on the machine; the cost is running Docker (six containers, ~2 GB images).
- Jev calls are not in traces (not LangChain); their cost stays in the turn financials.
- Another backend (Phoenix, LangSmith) is another `RunTracing` implementation.

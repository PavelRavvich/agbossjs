# ADR-0003 — Typed tools and MCP facades

- **Status:** Accepted
- **Issue:** #17 (sub-issues #18–#21)

## Context

Agents need tools — own functions and MCP servers. Without one typed mechanism every project would
plug them in differently, with untyped inputs, unbounded loops and spend outside the budget.

## Decision

- One tool type `Tool<Name, Input, Output>`, declared with `defineTool` (zod input and output);
  tool failures are results the model sees, not exceptions.
- MCP tools are used only through declared typed facades; the output schema is required.
  Contract drift or an unavailable server stops startup.
- The agent loop runs on `createAgent` (`langchain` v1) with middleware for usage, budget and cache
  (superseded: the framework's own loop, [ADR-0015](ADR-0015-Own-agent-loop)).
- The tool call limit is configuration: crossing it fails the run (fail fast); spend of the failed
  agent still reaches the ledger. Budget exhaustion inside a loop is a graceful stop.
- `effect: "write"` is marked now; human confirmation comes later.

## Consequences

- A typo in a tool name does not compile; a changed MCP contract fails at startup, not mid-run.
- A few lines of zod per MCP tool we use.
- Dependency on the `langchain` v1 agent API, which may still change.

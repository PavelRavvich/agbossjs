# ADR-0001 — Jev as default router

- **Status:** Accepted

## Context

Routing is classification over a fixed set of options. Chat models do it by generating text that
must be parsed, with uncalibrated confidence and token cost on every hop.

## Decision

Routers default to Jev (`typesafe/jev-1.13`) via the OpenRouter Decisions API
(`defaults.router`). Any router can override its model in config; an LLM router
(`kind: "llm"`) stays available.

## Consequences

- Probabilities per option, exact cost per call from the API.
- The Decisions API is alpha: failures are handled as `failed` outcomes, and switching a router to
  `kind: "llm"` is a config change.

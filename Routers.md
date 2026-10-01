# Routers

A router picks one option for a piece of text. It knows nothing about graphs or agents.

```ts
interface Router {
  readonly name: string;
  readonly route: (request: {
    input: string;
    options: RouteOption[];
  }) => Promise<RouteOutcome>;
}
type RouteOutcome =
  | {
      kind: "decided";
      decision: { next: string; reason: string };
      usage: UsageRecord;
    }
  | { kind: "failed"; reason: string; usage: UsageRecord };
```

| Kind  | How it decides                                             | Cost source          |
| ----- | ---------------------------------------------------------- | -------------------- |
| `jev` | OpenRouter Decisions API, `choice` question, probabilities | reported by the API  |
| `llm` | chat model replies with JSON, validated with zod           | tokens × price table |

Failures (HTTP error, malformed output, unknown option) are `failed` outcomes, never exceptions. An unknown option is named in the outcome (`unknownOption`).

**`finish` means "return to the user"**: the task is answered, _or the last agent asked the user a question_, or the task cannot be completed. The router also sees human decisions of the run (pause seam), so a rejected action ends the run instead of retrying.

**The first hop always goes to an agent**: until some agent has answered, `finish` is not offered.

**Trivial option sets cost nothing**: one option → `decided` (`single option`) without a model call;
no options → `failed` without a call. `usage` is then absent. Every router from `createRouter` has this.
Routers default to Jev — see [ADR-0001](ADR-0001-Jev-default-router).

## Isolation

- `src/routers` imports only `config`, `finops`, `llm`; the rest of `src` imports routers only via
  `src/routers/index.ts`. Enforced by ESLint.
- The graph talks to a router through `renderRouteInput(task, contributions)` → `input`.

## Testing routers on their own

`npm run test:routers` runs `tests/routers/` — plain `RouteRequest` fixtures, no graph, no agents.
Jev is tested with a fake `JevClient`, the LLM router with `FakeListChatModel`.

## `@Router` — a router as a flow node

> The graph engine is merged (#116, branch A); routers in job-scout move to `@Router` with branch B. See [Workflow](Workflow).

```ts
import { Router, route, Self } from "graphcompose/graph";

@Router({
  name: "review-gate",
  description: "Sends the code back or opens the pull request",
  prompt: "Is the review clean?",            // and / or promptUrls: ["./review-gate.prompt.md"]
  model: "typesafe/jev-1.13",                // the router's own model: Jev, or any chat model
  maxVisits: 3,                              // optional, no default
  routes: [
    route(CoderAgent, "The review asks for changes"),
    route(PullRequestConclusion, { promptUrls: ["./ship.route.md"] }),
    route(Self, "Ask the same agent again"),
  ],
})
export class ReviewGateRouter {}
```

- The router's prompt says **how** to choose; `routes` say **what** each choice means. Assembly checks `routes` against the router's `choose(...)` (`router.routes-mismatch`).
- Texts: `prompt` first, then `promptUrls` files (relative to the router's file) in order, joined with one blank line, normalised at load — BOM removed, line breaks `\n`, NFC, blank lines at the edges removed; indentation and inner blank lines kept.
- Routes are sent **sorted by target name** (`Self` as `self`) — declaration order changes neither the request nor its fingerprint.
- Decision through the existing routers (Jev for `*/jev-*`, an LLM router otherwise); one route → no model call.
- No guessing: a failed model call fails the run (`RouterDecisionError`, `router.failed`, with the model's reason and spend); an option that is not a route → `router.unknown-route`. `Self` leads back to the agent that ran last.

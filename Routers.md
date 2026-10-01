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

**There is no built-in `finish` option** (#116): a flow router's options are its `routes`, and "return
to the user" is a route to a conclusion. Say in that route's text when to take it — job-scout's answer
route reads _"Stop and send the answer: the contributions so far answer the message, or the last agent
asked the job seeker a question and waits for the reply, or it cannot be done"_. A terse text ("the last
answer fully covers the message") made Jev send the turn back to the agent that had just answered
(P(scout) 0.74 vs P(answer) 0.23 after the scout's list) until `maxVisits` failed the run. After a human
decision in the turn the router takes its conclusion route without a call (#100).

**Trivial option sets cost nothing**: one option → `decided` (`single option`) without a model call;
no options → `failed` without a call. `usage` is then absent. Every router from `createRouter` has this.
Routers default to Jev — see [ADR-0001](ADR-0001-Jev-default-router).

## Isolation

- `src/routers` imports only `config`, `finops`, `llm`; the rest of `src` imports routers only via
  `src/routers/index.ts`. Enforced by ESLint.
- The graph talks to a router through `renderRouteInput(task, contributions, memory)` → `input`;
  memory (summaries, previous turns) follows `defaults.history`.

## Testing routers on their own

`npm run test:routers` runs `tests/routers/` — plain `RouteRequest` fixtures, no graph, no agents.
Jev is tested with a fake `JevClient`, the LLM router with `FakeListChatModel`.

## `@Router` — a router as a flow node

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
- Decision through the existing routers (Jev for `*/jev-*`, an LLM router otherwise); one route → no model call. A chat-model router is priced like the agent (or compaction) that uses the same model; a model nobody prices → `UnknownRouterModelError`.
- No guessing: a failed model call fails the run (`RouterDecisionError`, `router.failed`, with the model's reason and spend); an option that is not a route → `router.unknown-route`. `Self` leads back to the agent that ran last.

### job-scout's main router

```ts
@Router({
  name: "main",
  description: "Sends the job seeker's message to the right agent, or sends the answer",
  prompt: "Pick who handles the job seeker's message next. Send the answer when the contributions so far already cover the message.",
  model: "typesafe/jev-1.13",
  maxVisits: 3,
  routes: [
    route(Profiler, "Reading the resume and proposing a search brief"),
    route(Scout, "Finding and ranking jobs"),
    route(Shortlist, "Saving chosen jobs to the shortlist, or showing it"),
    route(AnswerConclusion, "Stop and send the answer: the contributions so far answer the message, or the last agent asked the job seeker a question and waits for the reply, or it cannot be done (for example the job seeker rejected a required action)"),
  ],
})
export class MainRouter {}
```

`maxVisits: 3` — one message may pass through the router at most three times (two agents, then the
answer); a fourth visit fails the run (`routers.main.maxVisits`).

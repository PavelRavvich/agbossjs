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
to the user" is a route to a workflow finish. Say in that route's text when to take it — job-scout's answer
route reads _"Stop and send the answer: the contributions so far answer the message, or the last agent
asked the job seeker a question and waits for the reply, or it cannot be done"_. A terse text ("the last
answer fully covers the message") made Jev send the turn back to the agent that had just answered
(P(scout) 0.74 vs P(answer) 0.23 after the scout's list) until `maxVisits` failed the run. After a human
decision in the turn the router takes its workflow finish route without a call (#100).

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
import { route, file } from "graphcompose/core";
import { Router, Self } from "graphcompose/router";

@Router({
  name: "review-gate",
  description: "Sends the code back or opens the pull request",
  instructions: "Is the review clean?",      // or a file: instructions: file("./review-gate.prompt.md")
  model: "typesafe/jev-1.13",                // the router's own model: Jev, or any chat model
  maxVisits: 3,                              // required when the router is on a cycle, no default
  routes: [
    route("The review asks for changes").to(CoderAgent),
    route(file("./ship.route.md")).to(PullRequestWorkflowFinish),
    route("Ask the same agent again").to(Self),
  ],
})
export class ReviewGateRouter {}
```

- `maxVisits` bounds the cycles through the router: a router on a cycle (`router → agent → router`, or a `Self` route) must declare it, otherwise assembly fails with `router.unbounded-cycle`; a router only on a path may omit it. `limits.perRun.steps` stays the run-wide limit. `gc g router` writes `maxVisits: 1`; `gc create`'s main router has `maxVisits: 3`.
- The router's `instructions` say **how** to choose; `routes` say **what** each choice means. Assembly checks `routes` against the router's connections in the workflow graph (e.g. `routeOne(...)`) (`router.routes-mismatch`).
- Texts are resolved dynamically at runtime: `instructions` is evaluated as a `PromptInput`. (relative to the router's file) in order This allows changing files on the fly or loading conditions from a database.
- Routes are sent **sorted by target name** (`Self` as `self`) — declaration order changes neither the request nor its fingerprint.
- Decision through the existing routers (Jev for `*/jev-*`, an LLM router otherwise); one route → no model call. A chat-model router is priced like the agent (or compaction) that uses the same model; a model nobody prices → `UnknownRouterModelError`.
- No guessing: a failed model call fails the run (`RouterDecisionError`, `router.failed`, with the model's reason and spend); an option that is not a route → `router.unknown-route`. `Self` leads back to the agent that ran last.

### job-scout's main router

```ts
@Router({
  name: "main",
  description: "Sends the job seeker's message to the right agent, or sends the answer",
  instructions: "Pick who handles the job seeker's message next. Send the answer when the contributions so far already cover the message.",
  model: "typesafe/jev-1.13",
  maxVisits: 3,
  routes: [
    route("Reading the resume and proposing a search brief").to(Profiler),
    route("Finding and ranking jobs").to(Scout),
    route("Saving chosen jobs to the shortlist, or showing it").to(Shortlist),
    route("Stop and send the answer: the contributions so far answer the message, or the last agent asked the job seeker a question and waits for the reply, or it cannot be done").to(ChatWorkflowFinish),
  ],
})
export class MainRouter {}
```

`maxVisits: 3` — one message may pass through the router at most three times (two agents, then the
answer); a fourth visit fails the run (`routers.main.maxVisits`).


## Testing

Routers use the same LLM dynamic mocking approach as agents, but they return routing decisions instead of answers or tool calls.

```ts
import { modelOf, decide } from "graphcompose/testing";
import { MainRouter } from "./main.router";
import { SupportAgent } from "./support.agent";
import { FallbackAgent } from "./fallback.agent";

// LLM Routing dynamic mocking
modelOf(MainRouter).handle((req) => {
  if (req.input.includes("help")) {
    return decide(SupportAgent);
  }
  return decide(FallbackAgent);
});
```


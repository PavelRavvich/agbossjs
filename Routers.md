# Routers

Two things carry the name: the **`@Router` flow node** — a component that picks where a run goes
next — and the **router engine** underneath, which picks one option for a piece of text and knows
nothing about graphs or agents.

## `@Router` — a router as a flow node

<!--
```ts file=agents.ts
import { Agent, WorkflowFinish } from "graphcompose";
import { WorkflowFinishText } from "graphcompose/dto";
const model = "moonshotai/kimi-k2.6";
@Agent({ name: "coder", description: "Writes code", prompt: "Write the code.", model }) export class CoderAgent {}
@Agent({ name: "profiler", description: "Reads the resume", prompt: "Read the resume.", model }) export class Profiler {}
@Agent({ name: "scout", description: "Finds jobs", prompt: "Find jobs.", model }) export class Scout {}
@Agent({ name: "shortlist", description: "Keeps the shortlist", prompt: "Keep the shortlist.", model }) export class Shortlist {}
@WorkflowFinish({ name: "pull-request", description: "The pull request", output: WorkflowFinishText }) export class PullRequestWorkflowFinish {}
@WorkflowFinish({ name: "chat", description: "The answer", output: WorkflowFinishText }) export class ChatWorkflowFinish {}
```
-->

<!-- snippet-context
import { CoderAgent, PullRequestWorkflowFinish } from "./agents.js";
-->

```ts
import { Router, Self } from "graphcompose";

@Router({
  name: "review-gate",
  description: "Sends the code back or opens the pull request",
  prompt: "Is the review clean?", // or files next to the router: promptUrls: ["./review-gate.prompt.md"]
  model: "typesafe/jev-1.13", // the router's own model: a decision model, or any chat model
  maxVisits: 3, // required when the router is on a cycle, no default
  routes: [
    { prompt: "The review asks for changes", target: CoderAgent },
    { prompt: "Stop and open the pull request: the review is clean", target: PullRequestWorkflowFinish },
    { prompt: "Ask the same agent again", target: Self },
  ],
})
export class ReviewGateRouter {}
```

In the flow: `from(ReviewGateRouter).routes()` — the targets are the router's `routes`, the one list
of them ([Workflow](Workflow)).

- The router's `prompt` (or `promptUrls`) says **how** to choose; each route's `prompt` says **what**
  that choice means. A route may take its text from files too (`promptUrls`). A router without a
  prompt fails assembly (`router.no-prompt`), an empty route text too (`router.empty-route-text`).
- `maxVisits` bounds the cycles through the router: a router on a cycle (`router → agent → router`,
  or a `Self` route) must declare it, otherwise assembly fails with `router.unbounded-cycle`; a router
  only on a path may omit it. A run that passes it fails with `LimitExceededError`
  (`routers.<name>.maxVisits`). `limits.perRun.steps` stays the run-wide limit. `gc g router` writes
  `maxVisits: 1`; `gc create`'s main router has `maxVisits: 3`.
- Routes are sent **sorted by target name** (`Self` as `self`) — declaration order changes neither
  the request nor its fingerprint. `Self` leads back to the agent that ran last.
- A route's target may be `parallel(...)` / `optional(...)` ([Advanced Routing](Advanced-Routing)).
- The model is a **decision model** (`DECISION_MODELS`: Jev, `openai/gpt-6-luna-decisions`, …,
  served by `DecisionsModelProvider`: one choice question over the routes, probabilities, exact cost)
  or a **chat model** (answers with the option, validated). One route → no model call.
- No guessing: a failed model call fails the run (`RouterDecisionError`, `router.failed`, with the
  model's reason and spend); an option that is not a route → `router.unknown-route`.

**There is no built-in "finish" option**: "return to the user" is a route to a workflow finish.
Word that route as a stop instruction that says when to take it — job-scout's reads _"Stop and send
the answer: the contributions so far answer the message, or the last agent asked the job seeker a
question and waits for the reply, or it cannot be done"_. A terse text ("the last answer fully covers
the message") made Jev send the turn back to the agent that had just answered until `maxVisits`
failed the run.

### job-scout's main router

<!-- snippet-context
import { Router } from "graphcompose";
import { ChatWorkflowFinish, Profiler, Scout, Shortlist } from "./agents.js";
-->

```ts
@Router({
  name: "main",
  description: "Sends the job seeker's message to the right agent, or sends the answer",
  prompt:
    "Pick who handles the job seeker's message next. Send the answer when the contributions so far already cover the message.",
  model: "typesafe/jev-1.13",
  maxVisits: 3,
  routes: [
    { prompt: "Reading the resume and proposing a search brief", target: Profiler },
    { prompt: "Finding and ranking jobs", target: Scout },
    { prompt: "Saving chosen jobs to the shortlist, or showing it", target: Shortlist },
    {
      prompt:
        "Stop and send the answer: the contributions so far answer the message, or the last agent asked the job seeker a question and waits for the reply, or it cannot be done",
      target: ChatWorkflowFinish,
    },
  ],
})
export class MainRouter {}
```

`maxVisits: 3` — one message may pass through the router at most three times (two agents, then the
answer); a fourth visit fails the run (`routers.main.maxVisits`).

## The router engine

A `RouterEngine` (root entry) picks one option for a text:

<!-- snippet-context
import type { MessageContent } from "@langchain/core/messages";
import type { UsageRecord } from "graphcompose";
-->

```ts
interface RouterEngine {
  readonly name: string;
  readonly route: (request: RouteRequest) => Promise<RouteOutcome>;
}
interface RouteRequest {
  readonly input: MessageContent;
  readonly options: readonly { readonly name: string; readonly description: string }[];
  readonly instructions?: string;
}
type RouteOutcome =
  | { kind: "decided"; decision: { next: string; reason: string; confidence?: number }; usage?: UsageRecord }
  | { kind: "failed"; reason: string; usage?: UsageRecord; unknownOption?: string };
```

| Kind  | How it decides                                                  | Cost source          |
| ----- | --------------------------------------------------------------- | -------------------- |
| `jev` | OpenRouter Decisions API, a `choice` question, probabilities    | reported by the API  |
| `llm` | a chat model replies with the option, validated                 | tokens × price table |

Failures (HTTP error, malformed output, unknown option) are `failed` outcomes, never exceptions. One
option → `decided` without a model call; no options → `failed` without a call (`usage` absent).
Routers default to Jev — see [ADR-0001](ADR-0001-Jev-default-router).

Components use an engine for cheap decisions of their own through the `ROUTER_FACTORY` token —
job-scout's fit judge:

<!-- snippet-context
const FIT_QUESTION = "Does the job fit what the candidate wants?";
-->

```ts
import { Injectable, ROUTER_FACTORY, type RouterEngine } from "graphcompose";

@Injectable({ deps: [ROUTER_FACTORY] })
export class JobFitJudge {
  private readonly router: RouterEngine;

  constructor(routers: (name: string) => RouterEngine) {
    this.router = routers("job-fit"); // the model is defaults.router
  }

  async fits(profile: string, job: string): Promise<boolean> {
    const outcome = await this.router.route({
      instructions: FIT_QUESTION,
      input: `Candidate wants:\n${profile}\n\nJob:\n${job}`,
      options: [
        { name: "fit", description: "The job fits" },
        { name: "no_fit", description: "The job does not fit" },
      ],
    });
    return outcome.kind === "decided" && outcome.decision.next === "fit";
  }
}
```

## Isolation

- Inside the framework, `src/routers` imports only `config`, `finops`, `llm`; the rest of `src`
  imports routers only via `src/routers/index.ts` (ESLint-enforced). The engines' own tests are in
  `packages/graphcompose/tests/routers/` — plain `RouteRequest` fixtures, no graph, no agents.
- The graph renders the task, the contributions so far and the memory (`defaults.history`) into the
  router's `input`.

## Testing

In a workflow test a router answers by script — `routeTo(Target)` — or by a function of the request
([Testing](Testing)):

<!-- snippet-context
import { Agent, Router, Workflow, WorkflowFinish, WorkflowSettings, WorkflowStart, from, type WorkflowDefinition } from "graphcompose";
import { WorkflowFinishText, WorkflowStartText } from "graphcompose/dto";
@WorkflowStart({ name: "chat", description: "A message", input: WorkflowStartText })
class ChatStart { declare readonly input: WorkflowStartText; }
@WorkflowFinish({ name: "chat", description: "The answer", output: WorkflowFinishText })
class ChatFinish {}
@Agent({ name: "support", description: "Helps", prompt: "Help.", model: "moonshotai/kimi-k2.6" })
class SupportAgent {}
@Agent({ name: "fallback", description: "Anything else", prompt: "Answer.", model: "moonshotai/kimi-k2.6" })
class FallbackAgent {}
@Router({ name: "main", description: "Routes", prompt: "Pick who handles it.", model: "typesafe/jev-1.13", maxVisits: 3, routes: [{ prompt: "Support", target: SupportAgent }, { prompt: "Anything else", target: FallbackAgent }, { prompt: "Stop and send the answer: it is answered", target: ChatFinish }] })
class MainRouter {}
@Workflow({ name: "desk", version: "1.0.0", flow: [from(ChatStart).next(MainRouter), from(MainRouter).routes(), from(SupportAgent, FallbackAgent).next(MainRouter)], defaults: { models: { temperature: 0 }, router: { kind: "jev", model: "typesafe/jev-1.13" }, history: { limit: 5 } } })
class Desk implements WorkflowDefinition { settings() { return WorkflowSettings.builder().build(); } }
-->

```ts
import { expect } from "vitest";
import { replyWith, routeTo, testWith } from "graphcompose/testing";

const test = testWith(Desk);

test("help goes to support", async ({ app, mockLlm }) => {
  mockLlm(MainRouter).thenAnswer((request) =>
    request.kind === "decision" && request.input.toString().includes("help")
      ? routeTo(SupportAgent)
      : routeTo(ChatFinish),
  );
  mockLlm(SupportAgent).thenReturn(replyWith("On it."));

  const result = await app.execute(ChatStart, { text: "help" });

  expect(result).toFollowPath([ChatStart, MainRouter, SupportAgent, MainRouter, ChatFinish]);
});
```

`app.router(MainRouter).routeTo("…")` (the `app` fixture) asks one router alone with its scripted
model.

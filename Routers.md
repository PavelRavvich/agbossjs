# Routers

Two things carry the name: the **`@Router` flow node** — a component that picks where a run goes
next — and the **router engine** underneath, which picks one option for a piece of text and knows
nothing about graphs or agents.

## `@Router` — a router as a flow node

<!--
```ts file=agents.ts
import { Agent, WorkflowFinish, WorkflowStart } from "agboss";
import { Text, WorkflowFinishTextDto, WorkflowStartTextDto } from "agboss/dto";
const model = "moonshotai/kimi-k2.6";
export class CodeDto {
  @Text({ prompt: "the code" })
  code!: string;
}
export class ReviewDto {
  @Text({ prompt: "the review" })
  notes!: string;
}
@WorkflowStart({ name: "task-workflow-start", description: "A task", input: WorkflowStartTextDto }) export class TaskWorkflowStart {}
@Agent({ name: "coder-agent", description: "Writes code", prompt: "Write the code.", model, input: { task: WorkflowStartTextDto }, output: CodeDto, maxVisits: 3 }) export class CoderAgent {}
@Agent({ name: "reviewer-agent", description: "Reviews the code", prompt: "Review the code.", model, input: { code: CodeDto }, output: ReviewDto }) export class ReviewerAgent {}
@WorkflowFinish({ name: "pull-request-workflow-finish", description: "The pull request", output: CodeDto }) export class PullRequestWorkflowFinish {}
@Agent({ name: "profiler-agent", description: "Reads the resume", prompt: "Read the resume.", model }) export class ProfilerAgent {}
@Agent({ name: "scout-agent", description: "Finds jobs", prompt: "Find jobs.", model }) export class ScoutAgent {}
@Agent({ name: "shortlist-agent", description: "Keeps the shortlist", prompt: "Keep the shortlist.", model }) export class ShortlistAgent {}
@WorkflowStart({ name: "chat-workflow-start", description: "A message", input: WorkflowStartTextDto }) export class ChatWorkflowStart {}
@WorkflowFinish({ name: "chat-workflow-finish", description: "The answer", output: WorkflowFinishTextDto }) export class ChatWorkflowFinish {}
```
-->

<!-- snippet-context
import { CoderAgent, PullRequestWorkflowFinish, ReviewDto } from "./agents.js";
-->

```ts file=review-gate.router.ts
import { DecidedBy, Router } from "agboss";

@Router({
  name: "review-gate-router",
  description: "Sends the code back or opens the pull request",
  decidedBy: DecidedBy.Model,
  prompt: "Is the review clean?", // or files next to the router: promptUrls: ["./review-gate.prompt.md"]
  model: "typesafe/jev-1.13", // the router's own model: a decision model, or any chat model
  input: { review: ReviewDto }, // what it decides on, read from the path's scope
  maxVisits: 3, // a bound for the cycles through it
  routes: [
    { prompt: "The review asks for changes", target: CoderAgent },
    { prompt: "Stop and open the pull request: the review is clean", target: PullRequestWorkflowFinish },
  ],
})
export class ReviewGateRouter {}
```

In the flow the router's choice lists the same targets, each continued to its end
([Workflow](Workflow)):

<!-- snippet-context
import { Workflow, agent, route, start } from "agboss";
import { WorkflowStartTextDto } from "agboss/dto";
import { CodeDto, CoderAgent, PullRequestWorkflowFinish, ReviewDto, ReviewerAgent, TaskWorkflowStart } from "./agents.js";
import { ReviewGateRouter } from "./review-gate.router.js";
-->

```ts
@Workflow({
  name: "review-workflow",
  version: "1.0.0",
  flow: [
    start(TaskWorkflowStart)
      .returns(WorkflowStartTextDto)
      .toAgent(CoderAgent),

    // the coder is reached from the start and from the router: its own path
    agent(CoderAgent)
      .returns(CodeDto)
      .toAgent(ReviewerAgent)
      .returns(ReviewDto)
      .toRouter(ReviewGateRouter) // reached from one place: continued inline
      .chooseOne(route(CoderAgent), route(PullRequestWorkflowFinish)),
  ],
})
export class ReviewWorkflow {}
```

- The router's `prompt` (or `promptUrls`) says **how** to choose; each route's `prompt` says **what**
  that choice means. A router without a prompt fails assembly (`router.no-prompt`), an empty route
  text too (`router.empty-route-text`); `input` is required (`router.empty-input`) — the router sees
  its fields in its input message, like an agent.
- The flow's `chooseOne(route(…)…)` lists exactly the router's `routes` — as sets, the order does not
  matter (`[router.routes-mismatch]` names what is missing or extra). A target is an agent, an
  action, another router or a finish.
- `maxVisits` bounds the cycles: every cycle needs it on at least one of its nodes, a router or an
  agent (`[graph.cycle-without-max-visits]`). A visit past it fails before the model call with
  `VisitsLimitExceededError` (`limit.visits`, `<name>.maxVisits`), which `.onError` right after the
  step can take. `@Workflow({ maxSteps })` stays the run-wide limit. `agboss g router` writes
  `maxVisits: 1`.
- Routes are sent **sorted by target name** — declaration order changes neither the request nor its
  fingerprint.
- The model is a **decision model** (`DECISION_MODELS`: Jev, `openai/gpt-6-luna-decisions`, …,
  served by `DecisionsModelProvider`: one choice question over the routes, probabilities, exact cost)
  or a **chat model** (answers with the option, validated); without `model`, `defaults.router.model`.
  One route → no model call.
- No guessing: a failed model call fails the run (`RouterDecisionError`, `router.failed`, with the
  model's reason and spend); an option that is not a route → `router.unknown-route`. Code routers
  (`DecidedBy.Code`) come with #280.

**There is no built-in "finish" option**: "return to the user" is a route to a workflow finish.
Word that route as a stop instruction that says when to take it ("Stop and send the answer: …"). A
terse text ("the last answer fully covers the message") made Jev send the turn back to the agent
that had just answered until `maxVisits` failed the run.

### job-scout's main router

<!-- snippet-context
import { DecidedBy, Router } from "agboss";
import { WorkflowStartTextDto } from "agboss/dto";
import { ProfilerAgent, ScoutAgent, ShortlistAgent } from "./agents.js";
-->

```ts
@Router({
  name: "main-router",
  description: "Sends the job seeker's message to the agent that answers it",
  decidedBy: DecidedBy.Model,
  prompt: "Pick the agent that answers the job seeker's message.",
  model: "typesafe/jev-1.13",
  input: { message: WorkflowStartTextDto }, // the message (and the thread's earlier turns)
  maxVisits: 1,
  routes: [
    { prompt: "Reading the resume and proposing a search brief", target: ProfilerAgent },
    { prompt: "Finding and ranking jobs", target: ScoutAgent },
    { prompt: "Saving chosen jobs to the shortlist, or showing it", target: ShortlistAgent },
  ],
})
export class MainRouter {}
```

One path per turn: the router sends the message to one agent, whose answer finishes the turn
(`route(ScoutAgent).toFinish(ChatWorkflowFinish)`); the thread carries the conversation to the next
turn ([Example](Example)).

## The router engine

A `RouterEngine` (root entry) picks one option for a text:

<!-- snippet-context
import type { MessageContent } from "@langchain/core/messages";
import type { UsageRecord } from "agboss";
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
| ----- | ------------------------------------------------------------------- | --------------------- |
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
import { Injectable, ROUTER_FACTORY, type RouterEngine } from "agboss";

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
  `packages/agboss/tests/routers/` — plain `RouteRequest` fixtures, no graph, no agents.
- The flow renders the router's input fields and the thread's memory (`defaults.history`) into the
  engine's `input`.

## Testing

In a workflow test a router answers by script — `routeTo(Target)` — or by a function of the request
([Testing](Testing)):

<!--
```ts file=desk.workflow.ts
import { Agent, DecidedBy, Router, Workflow, WorkflowFinish, WorkflowStart, route, start } from "agboss";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "agboss/dto";
@WorkflowStart({ name: "desk-workflow-start", description: "A message", input: WorkflowStartTextDto })
export class DeskStart {}
@WorkflowFinish({ name: "desk-workflow-finish", description: "The answer", output: WorkflowFinishTextDto })
export class DeskFinish {}
@Agent({ name: "support-agent", description: "Helps", prompt: "Help.", model: "moonshotai/kimi-k2.6" })
export class SupportAgent {}
@Agent({ name: "fallback-agent", description: "Anything else", prompt: "Answer.", model: "moonshotai/kimi-k2.6" })
export class FallbackAgent {}
@Router({ name: "desk-router", description: "Routes", decidedBy: DecidedBy.Model, prompt: "Pick who handles it.", model: "typesafe/jev-1.13", input: { message: WorkflowStartTextDto }, routes: [{ prompt: "Support", target: SupportAgent }, { prompt: "Anything else", target: FallbackAgent }] })
export class DeskRouter {}
@Workflow({
  name: "desk-workflow",
  version: "1.0.0",
  flow: [
    start(DeskStart)
      .returns(WorkflowStartTextDto)
      .toRouter(DeskRouter)
      .chooseOne(
        route(SupportAgent)
          .toFinish(DeskFinish),
        route(FallbackAgent)
          .toFinish(DeskFinish),
      ),
  ],
})
export class Desk {}
```
-->

<!-- snippet-context
import { Desk, DeskFinish, DeskRouter, DeskStart, FallbackAgent, SupportAgent } from "./desk.workflow.js";
-->

```ts
import { expect } from "vitest";
import { replyWith, routeTo, testWith } from "agboss/testing";

const test = testWith(Desk);

test("help goes to support", async ({ app, mockLlm }) => {
  mockLlm(DeskRouter).thenAnswer((request) =>
    request.kind === "decision" && request.input.toString().includes("help")
      ? routeTo(SupportAgent)
      : routeTo(FallbackAgent),
  );
  mockLlm(SupportAgent).thenReturn(replyWith("On it."));

  const result = await app.execute(DeskStart, { text: "help" });

  expect(result).toFollowPath([DeskStart, DeskRouter, SupportAgent, DeskFinish]);
});
```

`app.router(DeskRouter).routeTo("…")` (the `app` fixture) asks one router alone with its scripted
model.

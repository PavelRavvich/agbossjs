# Routing patterns

Patterns of routers on the paths (#272): one choice, routers in a chain, a router in a loop, a
branch by the result of the chosen step, a router's failure. The grammar is on
[Workflow](Workflow), the router component on [Routers](Routers). Everything here is in the root
entry `agboss` (`start`, `router`, `route`, `caseOf`, `toAction`, `toFinish`, …); parallel
launches, quorums, code routers and child workflows build on these paths later (see the end).

The nodes used below (ordinary components):

<!--
```ts file=nodes.ts
import { Action, Agent, DecidedBy, Router, WorkflowFinish, WorkflowStart, type ActionHandler, type InputOf } from "agboss";
import { Text, WorkflowFinishTextDto, WorkflowStartTextDto, oneOf } from "agboss/dto";
const model = "moonshotai/kimi-k2.6";
export class TicketDto {
  @Text({ prompt: "the ticket" })
  summary!: string;
}
export class AnswerDto {
  @Text({ prompt: "the answer" })
  text!: string;
}
export class NeedsHumanDto {
  @Text({ prompt: "why a person must answer" })
  reason!: string;
}
@WorkflowStart({ name: "ticket-workflow-start", description: "A customer's message", input: WorkflowStartTextDto })
export class TicketWorkflowStart {}
@WorkflowFinish({ name: "answer-workflow-finish", description: "The answer", output: AnswerDto })
export class AnswerWorkflowFinish {}
@WorkflowFinish({ name: "reply-workflow-finish", description: "A text reply", output: WorkflowFinishTextDto })
export class ReplyWorkflowFinish {}
@WorkflowFinish({ name: "escalated-workflow-finish", description: "Handed to a person", output: NeedsHumanDto })
export class EscalatedWorkflowFinish {}
@WorkflowFinish({ name: "unrouted-workflow-finish", description: "Nobody could take it", output: WorkflowStartTextDto })
export class UnroutedWorkflowFinish {}
@Agent({ name: "billing-agent", description: "Billing questions", prompt: "Answer billing questions.", model, input: { message: WorkflowStartTextDto }, output: oneOf(AnswerDto, NeedsHumanDto) })
export class BillingAgent {}
@Agent({ name: "refund-agent", description: "Refunds", prompt: "Handle the refund.", model, input: { message: WorkflowStartTextDto }, output: AnswerDto })
export class RefundAgent {}
@Agent({ name: "chat-agent", description: "Small talk", prompt: "Chat.", model })
export class ChatAgent {}
@Agent({ name: "triage-agent", description: "Summarises the message as a ticket", prompt: "Summarise the message.", model, input: { message: WorkflowStartTextDto }, output: TicketDto, maxVisits: 2 })
export class TriageAgent {}
@Action({ name: "open-ticket-action", description: "Opens a ticket", input: { ticket: TicketDto }, output: AnswerDto })
export class OpenTicketAction implements ActionHandler<OpenTicketAction> {
  execute(input: InputOf<OpenTicketAction>): Promise<AnswerDto> {
    return Promise.resolve({ text: `ticket opened: ${input.ticket.value.summary}` });
  }
}
@Router({
  name: "money-router",
  description: "Billing or refund",
  decidedBy: DecidedBy.Model,
  prompt: "Is it about a bill or a refund?",
  input: { message: WorkflowStartTextDto },
  routes: [
    { prompt: "A question about a bill", target: BillingAgent },
    { prompt: "A refund", target: RefundAgent },
  ],
})
export class MoneyRouter {}
@Router({
  name: "front-router",
  description: "Money matters, small talk or a ticket",
  decidedBy: DecidedBy.Model,
  prompt: "Pick who handles the customer's message.",
  input: { message: WorkflowStartTextDto },
  routes: [
    { prompt: "Money: a bill or a refund", target: MoneyRouter },
    { prompt: "Small talk", target: ChatAgent },
    { prompt: "Anything else: open a ticket", target: TriageAgent },
    { prompt: "Stop without an answer: the message is empty or spam", target: UnroutedWorkflowFinish },
  ],
})
export class FrontRouter {}
@Router({
  name: "ticket-router",
  description: "Opens the ticket or asks again",
  decidedBy: DecidedBy.Model,
  prompt: "Is the ticket clear enough to open?",
  input: { ticket: TicketDto },
  maxVisits: 2,
  routes: [
    { prompt: "The ticket is clear", target: OpenTicketAction },
    { prompt: "The ticket is unclear: summarise again", target: TriageAgent },
  ],
})
export class TicketRouter {}
```
-->

## 1. One choice, routers in a chain

A router's choice lists its routes, each continued to its end. A route may lead to another router —
here the front router hands money matters to a second one:

<!-- snippet-context
import { Workflow, RouterDecisionError, agent, caseOf, route, start, toFinish } from "agboss";
import { WorkflowStartTextDto } from "agboss/dto";
import { AnswerDto, AnswerWorkflowFinish, BillingAgent, ChatAgent, EscalatedWorkflowFinish, FrontRouter, MoneyRouter, NeedsHumanDto, OpenTicketAction, RefundAgent, ReplyWorkflowFinish, TicketDto, TicketRouter, TicketWorkflowStart, TriageAgent, UnroutedWorkflowFinish } from "./nodes.js";
-->

```ts
@Workflow({
  name: "front-desk-workflow",
  version: "1.0.0",
  defaults: { router: { model: "typesafe/jev-1.13" } }, // the routers' model
  flow: [
    start(TicketWorkflowStart)
      .returns(WorkflowStartTextDto)
      .toRouter(FrontRouter)
      // 4. the router's own failure: a failed or unknown decision goes to a finish
      .onError(RouterDecisionError, toFinish(UnroutedWorkflowFinish))
      .chooseOne(
        // 1. a route to another router: its choice is continued right there
        route(MoneyRouter)
          .chooseOne(
            // 2. a branch by the result of the chosen agent
            route(BillingAgent)
              .switch(
                caseOf(AnswerDto)
                  .toFinish(AnswerWorkflowFinish),
                caseOf(NeedsHumanDto)
                  .toFinish(EscalatedWorkflowFinish),
              ),
            route(RefundAgent)
              .returns(AnswerDto)
              .toFinish(AnswerWorkflowFinish),
          ),
        route(ChatAgent)
          .toFinish(ReplyWorkflowFinish), // a text agent answers text
        // 3. a router in a loop: the triage agent is reached from two places → its own path
        route(TriageAgent),
        route(UnroutedWorkflowFinish),
      ),

    agent(TriageAgent)
      .returns(TicketDto)
      .toRouter(TicketRouter)
      .chooseOne(
        route(OpenTicketAction)
          .returns(AnswerDto)
          .toFinish(AnswerWorkflowFinish),
        route(TriageAgent), // back: maxVisits bounds the loop
      ),
  ],
})
export class FrontDeskWorkflow {}
```

## 2. A branch by the chosen step's result

An agent with a `oneOf` output continues with `.switch(caseOf(…)…)` — one case per variant, each
its own path; a missing or unknown case fails assembly (`[flow.switch-not-exhaustive]`,
`[flow.switch-unknown-case]`). Asking or refusing is just a case that leads to a finish.

## 3. A router in a loop

A node reached from two or more places is continued in its own path (`agent(TriageAgent)…`,
`router(R)…`), and every path into it ends at it — the loop is visible. Every cycle needs
`maxVisits` on one of its nodes (`[graph.cycle-without-max-visits]`); a visit past it fails before
the model call with `VisitsLimitExceededError`, which `.onError` right after that step can take.

## 4. When the router fails

`.onError(RouterDecisionError, …)` right after `.toRouter(R)` takes a failed or invalid decision; a
side path with `toAction(…)` can log it before its finish. Without a handler the run fails.

## Not in the core yet

| Pattern | Issue |
| --- | --- |
| Several branches at once — `.toParallelAgents(…)`, `.toParallelActions(…)`, a per-item launch from `listOf(…)` — with a mandatory `.join()` | #273 |
| Quorum joins (`.joinQuorum(…)`), groups | #279 |
| Code routers (`DecidedBy.Code`, `route(state)`) | #280 |
| Child workflows (`.toWorkflow(W)`, `caseOf` per child finish) | #263 |

The transition DSL's `nextParallel` / `join`, `batchParallel`, `@QuorumRouter`, `parallel(…)` /
`optional(…)` route targets, `Self` and nested `@Workflow` nodes were removed with it
([ADR-0019](ADR-0019-Flow-as-paths-with-path-scope)); rollback is on [Rollback](Rollback).

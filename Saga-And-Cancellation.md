# Saga Pattern & Global Cancellation

Workflows that call external APIs (payments, bookings) need to **undo** what they already did when a
later step fails — or when the caller cancels the run. AGBoss splits this into *what* undoes a
step (declared on the component) and *when* the undo runs (declared in the flow).

## 1. What undoes a step — `compensate`

A step declares its compensation: `@Agent({ compensate })` / `@WorkflowAction({ compensate })` name
the node that undoes it — an action or a whole workflow.

```ts file=booking.components.ts
import { Agent, WorkflowAction, type ActionContext } from "agboss";

/** Refunds the payment; safe to run twice thanks to the idempotency key. */
@WorkflowAction({ name: "refund-payment", description: "Refunds the payment" })
export class RefundPaymentAction {
  async execute(_state: unknown, ctx: ActionContext) {
    await fetch("https://payments.example.com/refunds", {
      method: "POST",
      headers: { "Idempotency-Key": ctx.idempotencyKey },
    });
    return {};
  }
}

@Agent({
  name: "process-payment",
  description: "Charges the customer",
  prompt: "Charge the customer for the booking.",
  model: "moonshotai/kimi-k2.6",
  compensate: RefundPaymentAction, // how to undo this step
})
export class ProcessPaymentAgent {}

@Agent({ name: "book-hotel", description: "Books the hotel", prompt: "Book the hotel.", model: "moonshotai/kimi-k2.6" })
export class BookHotelAgent {}
```

## 2. When the undo runs — `catchError(...).compensateWith(...)`

`catchError(Node, ErrorClass)` catches a failure of `Node` (by the error's stable `code`, so it holds
after a resume); `.compensateWith(Target)` is `.next(Target)` under a name that says what the target
is for. The compensating target runs instead of failing the run:

<!-- snippet-context
import { WorkflowFinish, WorkflowStart } from "agboss";
import { WorkflowFinishText, WorkflowStartText } from "agboss/dto";
import { BookHotelAgent, ProcessPaymentAgent, RefundPaymentAction } from "./booking.components.js";
@WorkflowStart({ name: "trip", description: "The trip to book", input: WorkflowStartText })
class TripStart { declare readonly input: WorkflowStartText; }
@WorkflowFinish({ name: "done", description: "What happened", output: WorkflowFinishText })
class Done {}
-->

```ts
import {
  Workflow,
  WorkflowCancelledError,
  WorkflowSettings,
  catchError,
  from,
  type WorkflowDefinition,
} from "agboss";

@Workflow({
  name: "travel",
  version: "1.0.0",
  flow: [
    from(TripStart).next(ProcessPaymentAgent),
    from(ProcessPaymentAgent).next(BookHotelAgent),
    from(BookHotelAgent).next(Done),
    // the run was cancelled while booking the hotel: refund the payment
    // (catchError(BookHotelAgent) — `Error`, the default — would catch every failure)
    catchError(BookHotelAgent, WorkflowCancelledError).compensateWith(RefundPaymentAction),
    from(RefundPaymentAction).next(Done),
  ],
  defaults: {
    models: { temperature: 0 },
    router: { kind: "jev", model: "typesafe/jev-1.13" },
    history: { limit: 5 },
  },
})
export class Travel implements WorkflowDefinition {
  settings() {
    return WorkflowSettings.builder().build();
  }
}
```

A linear flow names its compensations in the flow, as above. The `compensate` declarations are what
a saga runner reads to undo **every** completed step in reverse order — the case of parallel branches
or routing, where the flow cannot know in advance which steps ran. The framework's runner
(`LocalSagaStrategy`) is internal for now: it is not exported from a public entry.

## 3. Global cancellation

`app.cancel(thread)` stops a running run **softly**: the run stops before its next model or tool call
and `execute` rejects with `WorkflowCancelledError` (`workflow.cancelled`) — unless the flow catches
it, as above, and compensates. A paused run is dropped instead (its `resume` then throws
`NotPausedError`). `{ cancelled }` is `false` when the thread had neither.

<!-- snippet-context
import type { App } from "agboss";
declare const app: App;
declare const thread: string;
declare const userId: string;
-->

```ts
// e.g. in the API handler of a "Cancel" button
const { cancelled } = await app.cancel(thread, { owner: userId });
```

The caller's own `signal` (`execute(…, { signal })`) aborts the same way; tools see both as
`ctx.run.signal` ([Context and Authorization](Context-And-Authorization)).

## 4. Idempotency

Compensations — and any side effect — must be idempotent: a step interrupted by a crash may run
again. Actions get `ctx.idempotencyKey` = `${runId}:${node}` (`:${index}` inside a `batchParallel`),
the same after a resume; tools get `ctx.callId`. Pass them to the external API (most payment APIs
accept an idempotency key) and duplicates are filtered there.

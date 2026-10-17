# Cancellation and idempotency

Workflows that call external APIs (payments, bookings) need to **undo** what they already did when a
later step fails. Since #272 there is no saga engine and no `compensate` metadata: the framework
cannot know how to undo a tool call, a sent message or an MCP side effect, and an undo can fail
itself. An undo is written in the path, as explicit error handling — see [Rollback](Rollback):

```ts no-check: the pattern only — the full, compiled example is on the Rollback page
start(OrderWorkflowStart)
  .returns(OrderRequestDto)
  .toAction(ChargeCardAction)
  .returns(PaymentDto)
  .toAction(BookHotelAction)
  .onError(HotelUnavailableError, toAction(RefundPaymentAction).toFinish(NotBookedWorkflowFinish))
  .returns(BookingDto)
  .toFinish(BookedWorkflowFinish),
```

## Global cancellation

`app.cancel(thread)` stops a running run **softly**: the run stops before its next model or tool call
and `execute` rejects with `WorkflowCancelledError` (`workflow.cancelled`). A paused run is dropped
instead (its `resume` then throws `NotPausedError`). `{ cancelled }` is `false` when the thread had
neither.

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

The caller's own `signal` (`execute(…, { signal })`) aborts the same way; tools and actions see both
as `ctx.run.signal` ([Context and Authorization](Context-And-Authorization)). What a cancelled run
already did stays done: undo it from the caller, or in the next run.

## Idempotency

Undo actions — and any side effect — must be idempotent: a step interrupted by a crash may run
again. Actions get `ctx.idempotencyKey` = `${runId}:${node}:${visit}`, the same after a resume;
tools get `ctx.callId`. Pass them to the external API (most payment APIs accept an idempotency key)
and duplicates are filtered there.

<!--
```ts file=refund.workflow.ts
import { Action, Workflow, WorkflowFinish, WorkflowStart, start, type ActionContext, type ActionHandler, type InputOf } from "agboss";
import { Text } from "agboss/dto";
export class PaymentDto {
  @Text({ prompt: "the payment id" })
  paymentId!: string;
}
@WorkflowStart({ name: "refund-workflow-start", description: "A payment to refund", input: PaymentDto })
export class RefundWorkflowStart {}
@WorkflowFinish({ name: "refunded-workflow-finish", description: "Refunded", output: PaymentDto })
export class RefundedWorkflowFinish {}
```
-->

<!-- snippet-context
import { Action, Workflow, start, type ActionContext, type ActionHandler, type InputOf } from "agboss";
import { PaymentDto, RefundWorkflowStart, RefundedWorkflowFinish } from "./refund.workflow.js";
// @snippet
@Workflow({ name: "refund-workflow", version: "1.0.0", flow: [start(RefundWorkflowStart).returns(PaymentDto).toAction(RefundPaymentAction).toFinish(RefundedWorkflowFinish)] })
export class RefundWorkflow {}
-->

```ts
/** Refunds the payment; safe to run twice thanks to the idempotency key. */
@Action({ name: "refund-payment-action", description: "Refunds the payment", input: { payment: PaymentDto } })
export class RefundPaymentAction implements ActionHandler<RefundPaymentAction> {
  async execute(input: InputOf<RefundPaymentAction>, ctx: ActionContext): Promise<void> {
    await fetch(`https://payments.example.com/refunds/${input.payment.value.paymentId}`, {
      method: "POST",
      headers: { "Idempotency-Key": ctx.idempotencyKey },
    });
  }
}
```

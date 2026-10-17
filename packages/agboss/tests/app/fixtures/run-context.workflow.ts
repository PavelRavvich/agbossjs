import { TerminalUserChannel } from "../../../src/channels/terminal-channel.js";
import type { RunContext } from "../../../src/core/run-context.js";
import { Text, WorkflowStartTextDto } from "../../../src/dto/index.js";
import {
  Action,
  Agent,
  Tool,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  type ActionContext,
} from "../../../src/index.js";
import type { ToolContext, ToolHandler } from "../../../src/index.js";
import { start } from "../../helpers/flow.js";

/** What the components saw of their run, in order (the tests reset it with `resetSeen`). */
export const seen = {
  probes: [] as RunContext[],
  charges: [] as RunContext[],
  payments: [] as {
    readonly key: string;
    readonly run: RunContext;
    readonly executionContext?: unknown;
  }[],
  /** The signals a blocking call got: `ctx.signal` and `ctx.run.signal`. */
  blocked: [] as { readonly signal: AbortSignal; readonly run: AbortSignal }[],
};

export function resetSeen(): void {
  for (const list of Object.values(seen)) list.length = 0;
}

/** Resolves when a blocking call started, with its thread (set by the test before the run). */
export const blocking: { started?: (thread: string) => void } = {};

/** The clerk's answer, kept by the finish. */
export class ReceiptDto {
  @Text({ prompt: "what was done" })
  text!: string;
}

export class Query {
  @Text({ prompt: "what to look up" })
  text!: string;
}

/** A read tool: records the run it was called in. */
@Tool({ name: "probe", description: "Looks something up", input: Query, output: Query })
export class Probe implements ToolHandler<Query, Query> {
  run(input: Query, ctx: ToolContext): Promise<Query> {
    seen.probes.push(ctx.run);
    return Promise.resolve(input);
  }
}

/** A write tool: it waits for an approval, so a run pauses before it. */
@Tool({
  name: "charge",
  description: "Charges the card",
  channel: TerminalUserChannel,
  input: Query,
  output: Query,
})
export class Charge implements ToolHandler<Query, Query> {
  run(input: Query, ctx: ToolContext): Promise<Query> {
    seen.charges.push(ctx.run);
    return Promise.resolve(input);
  }
}

/** A long call: it waits until its run is cancelled. */
@Tool({ name: "wait", description: "Waits for a long time", input: Query, output: Query })
export class Wait implements ToolHandler<Query, Query> {
  run(input: Query, ctx: ToolContext): Promise<Query> {
    seen.blocked.push({ signal: ctx.signal, run: ctx.run.signal });
    blocking.started?.(ctx.run.threadId);
    return new Promise((resolve) => {
      ctx.run.signal.addEventListener("abort", () => {
        resolve(input);
      });
    });
  }
}

/** A slow read: the other branch answers meanwhile. */
@Tool({ name: "slow", description: "Looks something up slowly", input: Query, output: Query })
export class Slow implements ToolHandler<Query, Query> {
  run(input: Query): Promise<Query> {
    return new Promise((resolve) =>
      setTimeout(() => {
        resolve(input);
      }, 100),
    );
  }
}

@Agent({
  name: "clerk-agent",
  description: "Looks things up, charges cards and waits",
  prompt: "Do what you are asked.",
  tools: [Probe, Charge, Wait, Slow],
  model: "test/clerk",
  input: { message: WorkflowStartTextDto },
  output: ReceiptDto,
})
export class Clerk {}

/** Records its idempotency key and run (a payment would use the key). */
@Action({ name: "pay-action", description: "Pays" })
export class Pay {
  execute(_input: unknown, ctx: ActionContext): Promise<void> {
    seen.payments.push({
      key: ctx.idempotencyKey,
      run: ctx.run,
      executionContext: ctx.executionContext,
    });
    return Promise.resolve();
  }
}

@WorkflowStart({
  name: "start-workflow-start",
  description: "A request",
  input: WorkflowStartTextDto,
})
export class Start {}

@WorkflowFinish({ name: "finish-workflow-finish", description: "The reply", output: ReceiptDto })
export class Finish {}

const defaults = {
  models: { maxTokens: 100, temperature: 0 },
  history: { limit: 1 },
  tools: { maxToolCalls: 3 },
};

/** The clerk, then the payment. */
@Workflow({
  name: "checkout-workflow",
  version: "1.0.0",
  defaults,
  providers: [Pay],
  channelClasses: [TerminalUserChannel],
  flow: [
    start(Start)
      .returns(WorkflowStartTextDto)
      .toAgent(Clerk)
      .returns(ReceiptDto)
      .toAction(Pay)
      .toFinish(Finish),
  ],
})
export class Checkout {}

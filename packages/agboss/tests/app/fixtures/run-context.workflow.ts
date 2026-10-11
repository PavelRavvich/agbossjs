import { TerminalUserChannel } from "../../../src/channels/terminal-channel.js";
import {
  Agent,
  Tool,
  Workflow,
  WorkflowAction,
  type ActionContext,
} from "../../../src/components/decorators.js";
import { QuorumRouter, type QuorumStrategy } from "../../../src/concurrency/quorum.decorator.js";
import type { RunContext } from "../../../src/core/run-context.js";
import { Text, WorkflowFinishText, WorkflowStartText } from "../../../src/dto/index.js";
import {
  chain,
  from,
  WorkflowFinish,
  WorkflowSettings,
  WorkflowStart,
  type WorkflowDefinition,
} from "../../../src/index.js";
import type { AgentState, AgentStateUpdate } from "../../../src/graph/state.js";
import type { ToolContext, ToolHandler } from "../../../src/index.js";

/** What the components saw of their run, in order (the tests reset it with `resetSeen`). */
export const seen = {
  probes: [] as RunContext[],
  charges: [] as RunContext[],
  payments: [] as { readonly key: string; readonly run: RunContext }[],
  /** The signals a blocking call got: `ctx.signal` and `ctx.run.signal`. */
  blocked: [] as { readonly signal: AbortSignal; readonly run: AbortSignal }[],
};

export function resetSeen(): void {
  for (const list of Object.values(seen)) list.length = 0;
}

/** Resolves when a blocking call started, with its thread (set by the test before the run). */
export const blocking: { started?: (thread: string) => void } = {};

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
  name: "clerk",
  description: "Looks things up, charges cards and waits",
  prompt: "Do what you are asked.",
  tools: [Probe, Charge, Wait, Slow],
  model: "test/clerk",
})
export class Clerk {}

@Agent({ name: "scout", description: "Answers at once", prompt: "Answer.", model: "test/scout" })
export class Scout {}

/** Records its idempotency key and run (a payment would use the key). */
@WorkflowAction({ name: "pay", description: "Pays" })
export class Pay {
  execute(_state: AgentState, ctx: ActionContext): Partial<AgentStateUpdate> {
    seen.payments.push({ key: ctx.idempotencyKey, run: ctx.run });
    return {};
  }
}

@WorkflowStart({ name: "start", description: "A request", input: WorkflowStartText })
export class Start {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "finish", description: "The reply", output: WorkflowFinishText })
export class Finish {}

/** The first branch to answer is enough (`min: 1`); the others are cut off. */
@QuorumRouter({ name: "first" })
export class First implements QuorumStrategy {
  filterVote(): boolean {
    return true;
  }
  route(): typeof Finish {
    return Finish;
  }
}

const defaults = {
  models: { maxTokens: 100, temperature: 0 },
  history: { limit: 1 },
  tools: { maxToolCalls: 3 },
  router: { kind: "llm" as const, model: "test/router" },
};

class Settings implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder().build();
  }
}

/** The clerk, then the payment. */
@Workflow({
  name: "checkout",
  version: "1.0.0",
  defaults,
  providers: [Pay],
  channelClasses: [TerminalUserChannel],
  flow: [chain(Start, Clerk, Pay, Finish)],
})
export class Checkout extends Settings {}

/** The scout and the clerk in parallel; the first answer is enough (`min: 1`). */
@Workflow({
  name: "first-answer",
  version: "1.0.0",
  defaults,
  providers: [First],
  channelClasses: [TerminalUserChannel],
  flow: [
    from(Start).nextParallel(Scout, Clerk),
    from(Scout, Clerk).joinQuorum(First, { min: 1 }).routes(Finish),
  ],
})
export class FirstAnswer extends Settings {}

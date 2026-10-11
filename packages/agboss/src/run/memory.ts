import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { totalCost, type UsageRecord } from "../finops/usage.js";
import type { AgentStateType } from "../graph/state.js";
import { SlidingWindowStrategy } from "../memory/sliding-window.js";
import type { BaseMemoryStrategy, MemoryTurn, MemoryUpdate } from "../memory/types.js";
import type { TernOutcome } from "../terns/index.js";
import { compactIfDue, type Compacted } from "./compaction.js";
import type { FinishContext } from "./execute.js";
import type { RunDeps } from "./types.js";

/** What updating memory after a turn did: its spend (already recorded) and the compaction, if any. */
export interface MemoryAfterTurn extends MemoryUpdate {
  readonly usage: readonly UsageRecord[];
  readonly compacted?: Compacted;
}

/**
 * The built-in strategy of a workflow with `compaction`: agents see the sliding window over the
 * summaries and the turns not yet compacted; after a turn, every `every` uncompacted turns become one
 * summary written by the compaction model (through the model gateway, spend on the run's account).
 */
export class CompactionStrategy<TName extends string> extends SlidingWindowStrategy {
  constructor(
    private readonly deps: RunDeps<TName>,
    private readonly callbacks: BaseCallbackHandler[],
  ) {
    super();
  }

  override updateMemory(turn: MemoryTurn): Promise<MemoryAfterTurn> {
    return compactIfDue(this.deps, {
      threadId: turn.threadId,
      budgetLeftUsd: turn.budgetLeftUsd,
      callbacks: this.callbacks,
    });
  }
}

/** The agents' own strategies (`@Agent({ memoryStrategy })`), each instance once. */
const agentStrategiesOf = <TName extends string>(deps: RunDeps<TName>): BaseMemoryStrategy[] => [
  ...new Set(deps.memory?.values() ?? []),
];

/**
 * After a finished turn: the workflow's built-in strategy (compaction, when configured), then every
 * agent's own strategy update the memory; their spend is recorded to the run's account.
 */
export async function updateMemoryAfter<TName extends string>(
  ctx: FinishContext<TName>,
  state: AgentStateType,
  outcome: TernOutcome,
): Promise<MemoryAfterTurn> {
  const turn: MemoryTurn = {
    threadId: ctx.base.threadId,
    runId: ctx.runId,
    turn: { task: ctx.base.task, replyWith: outcome.replyWith, status: outcome.status },
    budgetLeftUsd: ctx.budgetUsd - totalCost(state.usage),
  };
  const builtIn =
    ctx.deps.config.compaction === undefined
      ? { usage: [] }
      : await new CompactionStrategy(ctx.deps, ctx.callbacks).updateMemory(turn);
  const usage = [...builtIn.usage];
  for (const strategy of agentStrategiesOf(ctx.deps)) {
    const left = turn.budgetLeftUsd - totalCost(usage);
    const update = await strategy.updateMemory?.({ ...turn, budgetLeftUsd: left });
    usage.push(...(update?.usage ?? []));
  }
  if (usage.length > 0) await ctx.record(usage);
  return builtIn.compacted === undefined ? { usage } : { usage, compacted: builtIn.compacted };
}

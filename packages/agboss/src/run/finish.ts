import type { FinishOutput } from "../app/types.js";
import { buildCostReport, totalCost } from "../finops/usage.js";
import type { FlowStateType } from "../graph/flow-state.js";
import type { AgentStateType } from "../graph/state.js";
import type { TernOutcome } from "../terns/index.js";
import { updateMemoryAfter } from "./memory.js";
import type { FinishContext } from "./execute.js";
import type { PendingPause } from "../pause/index.js";
import { isWaiting, pausedLoopOf } from "./paused.js";
import type { AgentExecutionOutput, RunDeps, RunStatus } from "./types.js";

/** Where the run ended: the workflow finish it reached, if it reached one (not when guarded or paused). */
function finishOf<TName extends string>(
  ctx: FinishContext<TName>,
  state: FlowStateType,
): { finish?: string; finishes?: Record<string, FinishOutput> } {
  const last = state.path.at(-1);
  const ref = last === undefined ? undefined : ctx.flow.model.nodes.get(last);
  return {
    ...(ref?.kind === "workflow-finish" ? { finish: ref.name } : {}),
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    ...(state.finishes && Object.keys(state.finishes).length > 0
      ? { finishes: state.finishes }
      : {}),
  };
}

function outcomeOf(state: AgentStateType, paused: boolean): TernOutcome & { status: RunStatus } {
  const status: RunStatus = paused ? "paused" : state.guarded === "" ? "answered" : "guarded";
  return {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    replyWith: paused ? "" : (state.replyWith ?? ""),
    status,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    stopReason: paused ? "waiting for approval" : (state.routeReason ?? ""),
    route: state.contributions.map((item) => item.agent),
    steps: state.contributions,
    costUsd: totalCost(state.usage),
  };
}

/** The visited nodes; a paused run waits in an agent whose visit has not finished yet. */
const pathOf = (state: FlowStateType, pending: PendingPause | undefined): readonly string[] =>
  pending === undefined ? state.path : [...state.path, pending.agent];

const traceUrlOf = <TName extends string>(
  deps: RunDeps<TName>,
  threadId: string,
): { traceUrl?: string } => {
  const traceUrl = deps.tracing?.sessionUrl(threadId);
  return traceUrl === undefined ? {} : { traceUrl };
};

/**
 * The state a run stopped in. A paused run waits inside an agent's loop (a subgraph): its spend so far
 * and the pending call are there — that spend goes to the ledger now, not on resume.
 */
async function stoppedState<TName extends string>(
  ctx: FinishContext<TName>,
  state: FlowStateType,
): Promise<{
  readonly current: AgentStateType;
  readonly paused: boolean;
  readonly pending?: PendingPause;
}> {
  const pause = ctx.deps.pause;
  if (pause === undefined || !(await isWaiting(ctx.flow.graph, ctx.runId))) {
    return { current: state, paused: false };
  }
  const loop = await pausedLoopOf(ctx.flow.graph, pause.checkpointer, ctx.runId);
  if (loop === undefined) return { current: state, paused: true };
  await ctx.record(loop.state.usage.slice(Math.max(ctx.recorded, state.usage.length)));
  return { current: loop.state, paused: true, pending: loop.pending };
}

/** Writes (or completes) the Tern and shapes the result: answered, guarded or paused. */
export async function finishRun<TName extends string>(
  ctx: FinishContext<TName>,
  state: FlowStateType,
  existingTernId?: string,
): Promise<AgentExecutionOutput> {
  const { current, paused, pending } = await stoppedState(ctx, state);
  const outcome = outcomeOf(current, paused);
  let ternId = existingTernId;
  if (ternId === undefined) ternId = (await ctx.deps.terns.append({ ...ctx.base, ...outcome })).id;
  else await ctx.deps.terns.complete(ternId, outcome);
  const memory = paused ? { usage: [] } : await updateMemoryAfter(ctx, current, outcome);
  return {
    status: outcome.status,
    replyWith: outcome.replyWith,
    route: outcome.route,
    path: pathOf(state, pending),
    stopReason: outcome.stopReason,
    budgetUsd: ctx.budgetUsd,
    cost: buildCostReport([...current.usage, ...memory.usage]),
    threadId: ctx.base.threadId,
    ternId,
    runId: ctx.runId,
    ...(paused ? {} : finishOf(ctx, state)),
    ...(pending === undefined ? {} : { pending }),
    ...traceUrlOf(ctx.deps, ctx.base.threadId),
    ...(memory.compacted === undefined ? {} : { compacted: memory.compacted }),
  };
}

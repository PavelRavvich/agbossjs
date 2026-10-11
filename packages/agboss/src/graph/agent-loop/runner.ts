import type { FlowStateType, FlowStateUpdate } from "../flow-state.js";
import { subgraphNode } from "../subgraph-node.js";
import type { FlowNodeRunner } from "../visit.js";
import type { AgentLoopGraph } from "./loop-graph.js";
import type { AgentLoopStateType } from "./state.js";

/** What the flow hands an agent: its state, the agent's name as `next`, where the run is so far. */
export function loopInputOf(state: FlowStateType, agent: string): AgentLoopStateType {
  return {
    task: state.task,
    startInput: state.startInput,
    history: state.history,
    runId: state.runId,
    optionalBranches: [],
    next: agent,
    routeReason: state.routeReason,
    start: state.start,
    finishes: state.finishes,
    previousAgent: state.previousAgent,
    visits: state.visits,
    steps: state.steps,
    daySpentBeforeRunUsd: state.daySpentBeforeRunUsd,
    forks: state.forks,
    path: state.path,
    contributions: state.contributions,
    budgetUsd: state.budgetUsd,
    usage: state.usage,
    replyWith: state.replyWith,
    payload: state.payload,
    summaries: state.summaries,
    approvals: state.approvals,
    guarded: state.guarded,
    flowPath: [...state.path, agent],
    from: {
      contributions: state.contributions.length,
      usage: state.usage.length,
      approvals: state.approvals.length,
    },
    messages: [],
    move: null,
    results: {},
    decisions: {},
    modelCalls: 0,
    toolCalls: 0,
    reply: null,
    retries: 0,
    // The item of this worker in a `batchParallel` step (the `{{item}}` prompt variable).
    batchItem: state.batchItem,
    batchIndex: state.batchIndex,
    _batchCursor: {},
    lastError: null,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    cancelRequested: state.cancelRequested ?? false,
  };
}

/** What the loop added to the flow's appended lists: the replyWith, the spend, the decisions. */
export const loopUpdate = (after: AgentLoopStateType): FlowStateUpdate => ({
  contributions: after.contributions.slice(after.from.contributions),
  usage: after.usage.slice(after.from.usage),
  approvals: after.approvals.slice(after.from.approvals),
});

/**
 * The flow node of one agent: its loop as a subgraph, its additions merged back into the flow
 * state. A pause inside (`interrupt`) pauses the whole run; on resume the loop continues from its
 * own checkpoint, so the flow's input is not read again.
 */
export const agentRunner = (loop: AgentLoopGraph, agent: string): FlowNodeRunner =>
  subgraphNode(loop, {
    input: (state) => loopInputOf(state, agent),
    output: loopUpdate,
  });

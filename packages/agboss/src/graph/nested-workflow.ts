import type { RunnableConfig } from "@langchain/core/runnables";
import type { FlowNodeRef } from "./flow-nodes.js";
import type { FlowStateType, FlowStateUpdate } from "./flow-state.js";
import type { InvokableGraph } from "./subgraph-node.js";
import type { FlowNodeRunner } from "./visit.js";

/** A nested workflow's graph, as its node runs it. */
export type NestedGraph = InvokableGraph<FlowStateType, FlowStateType>;

/**
 * What a nested workflow starts from: the parent's run so far (task, history, payload, spend and
 * counters, so limits hold across both), without the parent's position (its start, forks, cursor).
 */
export const childInputOf = (state: FlowStateType): FlowStateType => ({
  ...state,
  start: "",
  next: "",
  forks: {},
  _batchCursor: {},
  optionalBranches: [],
  lastError: null,
});

/** The visits the child added, per node. */
function visitsAdded(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(after)
      .map(([key, count]) => [key, count - (before[key] ?? 0)] as const)
      .filter(([, added]) => added > 0),
  );
}

/**
 * What a nested workflow adds to the parent's run — only its own part, so nothing the parent had
 * before is counted twice: its contributions, model calls, approvals, steps and visits, its path
 * (after the workflow's node), and its payload. Its finish is its own: the parent finishes itself.
 */
export function childDelta(
  node: FlowNodeRef,
  before: FlowStateType,
  after: FlowStateType,
): FlowStateUpdate {
  return {
    contributions: after.contributions.slice(before.contributions.length),
    usage: after.usage.slice(before.usage.length),
    approvals: after.approvals.slice(before.approvals.length),
    path: [node.key, ...after.path.slice(before.path.length)],
    visits: { ...visitsAdded(before.visits, after.visits), [node.key]: 1 },
    steps: after.steps - before.steps,
    payload: after.payload,
    previousAgent: after.previousAgent,
    daySpentBeforeRunUsd: after.daySpentBeforeRunUsd,
    ...(after.guarded === "" ? {} : { guarded: after.guarded }),
  };
}

/**
 * The node of a nested `@Workflow`: its own compiled flow as a subgraph, run with the node's config
 * (a pause inside pauses the whole run; checkpoint namespaces keep its state apart), merged back as
 * its delta.
 */
export const nestedWorkflowRunner =
  (node: FlowNodeRef, graph: NestedGraph): FlowNodeRunner =>
  async (state, config?: RunnableConfig) =>
    childDelta(node, state, await graph.invoke(childInputOf(state), config));

/** The node of a nested workflow: its graph, compiled before the parent's (`compileSubgraphs`). */
export function nestedRunner(
  node: FlowNodeRef,
  subgraphs: ReadonlyMap<string, { readonly graph: NestedGraph }>,
): FlowNodeRunner {
  const child = subgraphs.get(node.key);
  if (child === undefined) throw new Error(`Missing compiled child graph for ${node.key}`);
  return nestedWorkflowRunner(node, child.graph);
}

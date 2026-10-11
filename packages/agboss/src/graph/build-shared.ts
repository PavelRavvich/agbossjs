import { END, type StateGraph } from "@langchain/langgraph";
import type { FlowModel } from "./check-flow.js";
import type { FlowNodeRef } from "./flow-nodes.js";
import type { FlowState, FlowStateType, FlowStateUpdate } from "./flow-state.js";

/** The LangGraph builder of a flow graph. */
export type Builder = StateGraph<typeof FlowState.spec, FlowStateType, FlowStateUpdate, string>;

/**
 * The LangGraph node of a flow node: `<kind>.<name>` (e.g. `workflow-finish.chat`) — flow names may
 * equal state keys (`replyWith`), which LangGraph does not allow as node names.
 */
export const graphNodeId = (node: Pick<FlowNodeRef, "kind" | "name">): string =>
  `${node.kind}.${node.name}`;

/** A node of a checked flow by key (every transition target is a node once the rules pass). */
export function nodeKeyed(model: FlowModel, key: string): FlowNodeRef {
  const ref = model.nodes.get(key);
  if (ref === undefined) throw new Error(`Flow node "${key}" is missing after the rules passed`);
  return ref;
}

/** Node key → graph node id, for the given keys (a conditional edge's path map). */
export const pathMap = (model: FlowModel, keys: readonly string[]): Record<string, string> =>
  Object.fromEntries(
    keys.map((key) => {
      if (key === "skip-wrap") return ["skip-wrap", "skip-wrap"];
      if (key === END) return [END, END];
      return [key, graphNodeId(nodeKeyed(model, key))];
    }),
  );

/** The loop node of a `batchParallel` step: takes the next batches and sends them to the workers. */
export const batchLoopId = (sourceKey: string, targetKey: string): string =>
  `__mapeach_${sourceKey}_to_${targetKey}`;

/** The worker copy of a `batchParallel` target: one run per batch, back to the loop node. */
export const batchWorkerId = (target: Pick<FlowNodeRef, "kind" | "name">): string =>
  `${graphNodeId(target)}_batch_clone`;

/** Where the loop goes when no batch is left: leaves by the target's own next step. */
export const batchFinishId = (target: Pick<FlowNodeRef, "kind" | "name">): string =>
  `${graphNodeId(target)}_batch_finish`;

/** Whether a flow node is the target of a `batchParallel` step. */
export const isBatchTarget = (model: FlowModel, key: string): boolean =>
  model.collected.transitions.some((t) => t.next.kind === "batchParallel" && t.next.target === key);

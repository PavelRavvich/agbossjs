import type { RunnableConfig } from "@langchain/core/runnables";
import type { FlowStateType, FlowStateUpdate } from "./flow-state.js";
import type { FlowNodeRunner } from "./visit.js";

/** A compiled graph, as far as a flow node needs it. */
export interface InvokableGraph<TInput, TOutput> {
  invoke(input: TInput, config?: RunnableConfig): Promise<TOutput>;
}

/** How a subgraph's own state maps to and from the flow state. */
export interface SubgraphMapping<TInput, TOutput> {
  readonly input: (state: FlowStateType) => TInput;
  readonly output: (result: TOutput) => FlowStateUpdate;
}

/**
 * A compiled subgraph as one flow node. It runs with the node's config, so an `interrupt()` inside
 * it pauses the whole run and `Command({ resume })` continues it (checkpoint namespaces).
 */
export function subgraphNode<TInput, TOutput>(
  subgraph: InvokableGraph<TInput, TOutput>,
  mapping: SubgraphMapping<TInput, TOutput>,
): FlowNodeRunner {
  return async (state, config) =>
    mapping.output(await subgraph.invoke(mapping.input(state), config));
}

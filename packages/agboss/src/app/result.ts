import { checkFlow } from "../graph/check-flow.js";
import { componentOf } from "../components/metadata.js";

import { unwrapTarget, type Flow, type FlowNode, type FlowStep } from "../graph/flow.js";
import type { AgentExecutionOutput } from "../run/types.js";
import type { ExecutionOutput } from "./types.js";

/** Flow nodes by their key: the classes and named nodes a run's path is read back into. */
export type FlowNodesByKey = ReadonlyMap<string, FlowNode>;

const nodesOfStep = (step: FlowStep): readonly FlowNode[] => {
  switch (step.kind) {
    case "to":
      return [...step.from, ...step.targets.map(unwrapTarget)];
    case "batchParallel":
      return [...step.from, step.target];
    case "choose":
      return [
        ...step.from,
        ...step.targets.filter(
          (t): t is FlowNode =>
            typeof t === "function" ||
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            (typeof t === "object" && t !== null && ("use" in t || "name" in t)),
        ),
      ];
    case "chain":
      return step.nodes;
    case "join":
    case "joinAny":
    case "joinQuorum":
      return [...step.from, step.target];
    case "catch":
      return [step.target, step.nextNode];
  }
};

/** Every node of a flow (checked by the assembly rules) by its key. */
export function flowNodesByKey(flow: Flow): FlowNodesByKey {
  const { collected } = checkFlow(flow);
  const byKey = new Map<string, FlowNode>();
  for (const node of flow.flatMap(nodesOfStep)) {
    const key = collected.keyOf(node);
    if (key !== undefined && !byKey.has(key)) byKey.set(key, node);
  }
  return byKey;
}

/**
 * Every node of a flow and of the workflows nested in it, by key (the parent's node first when a
 * key repeats): a run's path goes through the nested workflows' nodes too.
 */
export function nestedFlowNodesByKey(flow: Flow): FlowNodesByKey {
  const byKey = new Map(flowNodesByKey(flow));
  for (const node of [...byKey.values()]) {
    const component = typeof node === "function" ? componentOf(node) : undefined;
    if (component?.kind !== "workflow") continue;
    for (const [key, nested] of nestedFlowNodesByKey(component.meta.flow)) {
      if (!byKey.has(key)) byKey.set(key, nested);
    }
  }
  return byKey;
}

/** A run of the core, as the app reports it. */
export function runResultOf(run: AgentExecutionOutput, nodes: FlowNodesByKey): ExecutionOutput {
  return {
    thread: run.threadId,
    runId: run.runId,
    status: run.status,
    replyWith: run.replyWith,
    route: run.route,
    stopReason: run.stopReason,
    path: run.path.flatMap((key) => {
      const node = nodes.get(key);
      return node === undefined ? [] : [node];
    }),
    spend: run.cost,
    ...(run.finish === undefined ? {} : { finish: run.finish, output: { text: run.replyWith } }),
    ...(run.finishes && Object.keys(run.finishes).length > 0 ? { finishes: run.finishes } : {}),
    ...(run.pending === undefined ? {} : { pause: run.pending }),
    ...(run.compacted === undefined ? {} : { compacted: run.compacted }),
    ...(run.traceUrl === undefined ? {} : { traceUrl: run.traceUrl }),
  };
}

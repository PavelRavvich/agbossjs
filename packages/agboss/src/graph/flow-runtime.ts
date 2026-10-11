import { defaultSummaries } from "./agent-definitions.js";
import { assembleFlowGraph, type FlowGraph, type FlowRuntime } from "./build.js";
import type { GraphDeps } from "./deps.js";
import { flowRunners } from "./flow-runners.js";
import type { WorkflowLimits } from "./settings.js";
import type { SpentToday } from "./visit.js";

/** The limits one run is held to and the spend of its account today. */
export interface RunLimits {
  readonly limits: WorkflowLimits;
  readonly spentToday: SpentToday;
}

/** The engine's runtime for a workflow: the existing nodes as runners, its routers, its limits. */
export function flowRuntimeOf<TName extends string>(
  deps: GraphDeps<TName>,
  run: RunLimits,
): FlowRuntime {
  return {
    runnerFor: flowRunners(deps, run),
    routerFor: deps.routerFor,
    routers: deps.routers,
    routerMemory: {
      summaries: defaultSummaries(deps.config),
      turns: deps.config.defaults.history.limit,
    },
    limits: run.limits,
    spentToday: run.spentToday,
    ...(deps.pause === undefined ? {} : { checkpointer: deps.pause.checkpointer }),
    observer: deps.observer,
    quorumRouters: deps.quorumRouters,
    container: deps.container,
    batchStrategies: deps.batchStrategies,
  };
}

/** The workflow's flow assembled into a LangGraph graph for one run. */
export async function flowGraphOf<TName extends string>(
  deps: GraphDeps<TName>,
  run: RunLimits,
): Promise<FlowGraph> {
  return assembleFlowGraph(deps.flow, flowRuntimeOf(deps, run));
}

import type { AppDeps } from "../app/app-deps.js";
import type { CompiledFlowGraph } from "./build.js";
import { flowGraphOf } from "./flow-runtime.js";

/**
 * The workflow's flow graph for LangGraph Studio: Studio runs it itself, so tracing callbacks (when
 * on) are bound to the graph. Session "studio" groups Studio runs in Langfuse. The flow's limits
 * apply; the day's spend is read from the workflow's ledger.
 */
export async function studioGraph(deps: AppDeps): Promise<CompiledFlowGraph> {
  const { graph } = await flowGraphOf(deps, {
    limits: deps.limits,
    spentToday: () => deps.ledger.spentToday(deps.config.name),
  });
  if (deps.tracing === undefined) return graph;
  const callbacks = deps.tracing.callbacks({
    bundle: deps.config.name,
    threadId: "studio",
    runId: "studio",
  });
  return graph.withConfig({ callbacks });
}

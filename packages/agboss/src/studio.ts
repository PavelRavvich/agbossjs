import { createAppDeps } from "./app/app-deps.js";
import { workflowOf, type Class } from "./components/index.js";
import { studioGraph } from "./graph/studio-graph.js";

/** A workflow's graph for LangGraph Studio: `export const graph = await studioGraphOf(MyWorkflow)`. */
export async function studioGraphOf(
  workflow: Class,
): Promise<Awaited<ReturnType<typeof studioGraph>>> {
  return studioGraph(await createAppDeps(await workflowOf(workflow)));
}

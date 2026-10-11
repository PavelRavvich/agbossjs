import type { Class } from "../components/injection.js";
import { componentOf, requireComponent } from "../components/metadata.js";
import { moduleOf, workflowTreeOf } from "../components/nested-modules.js";
import type { WorkflowMeta } from "../components/meta-types.js";
import { collectFlow } from "../graph/flow-nodes.js";

/** The workflow's module: its own settings with its nested workflows' merged in. */
const metaOf = (workflow: Class): WorkflowMeta => moduleOf(workflow);

/** The workflow's MCP server classes and their names. */
export function mcpServersOf(workflow: Class): ReadonlyMap<Class, string> {
  return new Map(
    (metaOf(workflow).mcp ?? []).map(
      (cls) => [cls, requireComponent(cls, "mcp-server", "testWith").meta.name] as const,
    ),
  );
}

/** Every class the workflow's container may create: providers, the agents' tools and knowledge bases. */
export function usedComponentsOf(workflow: Class): ReadonlySet<Class> {
  const meta = metaOf(workflow);
  const refs = workflowTreeOf(workflow).flatMap((module) => [
    ...collectFlow(module.meta.flow).nodes.values(),
  ]);
  const agents = refs.flatMap((ref) => {
    const component = componentOf(ref.use);
    return component?.kind === "agent" ? [component.meta] : [];
  });
  return new Set<Class>([
    ...(meta.providers ?? []).filter((provider): provider is Class => !("provide" in provider)),
    ...agents.flatMap((agent) => agent.tools ?? []),
    ...agents.flatMap((agent) => (agent.rag ?? []).map((binding) => binding.use)),
  ]);
}

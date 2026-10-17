import type { Class } from "../components/injection.js";
import { requireComponent } from "../components/metadata.js";
import { moduleOf } from "../components/module.js";
import { NodeKind } from "../flow/ast.js";
import { isCodeNode } from "../flow/runtime/graph-model.js";
import type { AssembledWorkflow } from "../workflow.js";

/** The workflow's MCP server classes and their names. */
export function mcpServersOf(workflow: Class): ReadonlyMap<Class, string> {
  return new Map(
    (moduleOf(workflow).mcp ?? []).map(
      (cls) => [cls, requireComponent(cls, "mcp-server", "testWith").meta.name] as const,
    ),
  );
}

/**
 * Every class the workflow's container may create: providers, the agents' tools and knowledge
 * bases, its actions, finishes and code routers.
 */
export function usedComponentsOf(workflow: Class, bundle: AssembledWorkflow): ReadonlySet<Class> {
  const providers = (moduleOf(workflow).providers ?? []).filter(
    (provider): provider is Class => !("provide" in provider),
  );
  const nodes = [...bundle.graph.nodes.values()];
  const agents = nodes.flatMap((node) =>
    node.declaration.kind === NodeKind.Agent ? [node.declaration.options] : [],
  );
  const codeNodes = nodes.flatMap((node) =>
    isCodeNode(node) || node.kind === NodeKind.Finish ? [node.component] : [],
  );
  return new Set<Class>([
    ...providers,
    ...agents.flatMap((agent) => agent.tools ?? []),
    ...agents.flatMap((agent) => (agent.rag ?? []).map((binding) => binding.use)),
    ...codeNodes,
  ]);
}

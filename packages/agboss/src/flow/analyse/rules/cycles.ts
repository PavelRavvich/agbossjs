import { violation, type RuleViolation } from "../../../graph/rule-error.js";
import { NodeKind } from "../../ast.js";
import type { ComponentName } from "../../registry.js";
import type { FlowEdge, FlowNode } from "../flow-graph.js";
import type { AnalysisContext } from "./context.js";

/**
 * `[graph.cycle-without-max-visits]` (#272 AC11, AC14): every cycle passes a router or an agent with
 * `maxVisits` — the only rule on cycles; a cycle may be entered at any of its nodes. Removing the
 * bounded nodes must leave no cycle: each strongly connected component left is a cycle no limit
 * stops.
 */

const isBounded = (node: FlowNode): boolean =>
  (node.declaration.kind === NodeKind.Agent || node.declaration.kind === NodeKind.Router) &&
  node.declaration.options.maxVisits !== undefined;

/** Tarjan's strongly connected components over the given nodes and edges. */
function stronglyConnected(
  nodes: readonly ComponentName[],
  edges: readonly FlowEdge[],
): readonly (readonly ComponentName[])[] {
  const index = new Map<ComponentName, number>();
  const low = new Map<ComponentName, number>();
  const stack: ComponentName[] = [];
  const onStack = new Set<ComponentName>();
  const components: ComponentName[][] = [];
  const visit = (node: ComponentName): void => {
    index.set(node, index.size);
    low.set(node, index.get(node) ?? 0);
    stack.push(node);
    onStack.add(node);
    for (const edge of edges.filter((candidate) => candidate.from === node)) {
      if (!index.has(edge.to)) visit(edge.to);
      if (onStack.has(edge.to)) {
        low.set(node, Math.min(low.get(node) ?? 0, low.get(edge.to) ?? 0));
      }
    }
    if (low.get(node) !== index.get(node)) return;
    const component: ComponentName[] = [];
    for (let top = stack.pop(); top !== undefined; top = top === node ? undefined : stack.pop()) {
      onStack.delete(top);
      component.push(top);
    }
    components.push(component.sort());
  };
  for (const node of nodes) if (!index.has(node)) visit(node);
  return components;
}

export function cycleRules(context: AnalysisContext): readonly RuleViolation[] {
  const unbounded = [...context.graph.nodes.values()].filter((node) => !isBounded(node));
  const names = new Set(unbounded.map((node) => node.name));
  const edges = context.graph.edges.filter((edge) => names.has(edge.from) && names.has(edge.to));
  return stronglyConnected([...names], edges)
    .filter(
      (component) =>
        component.length > 1 ||
        edges.some((edge) => edge.from === component[0] && edge.to === component[0]),
    )
    .map((component) => {
      const message =
        `the cycle through ${component.join(", ")} has no maxVisits — set maxVisits on one of ` +
        "its agents or routers";
      return violation("graph.cycle-without-max-visits", message, component);
    });
}

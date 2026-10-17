import { violation, type RuleViolation } from "../../../graph/rule-error.js";
import { NodeKind } from "../../ast.js";
import { EdgeKind, reachableFrom } from "../flow-graph.js";
import type { AnalysisContext } from "./context.js";

/**
 * The graph rules that stay (#272 AC11): a workflow start exists, every node is reachable from a
 * start, and every path ends in a finish or at a shared node (no dead end). Nothing after a finish
 * is found while walking (`walk.ts`).
 */

function noWorkflowStart(context: AnalysisContext): readonly RuleViolation[] {
  if (context.graph.starts.length > 0) return [];
  const message = "the flow has no workflow start — begin a path with start(…) of a @WorkflowStart";
  return [violation("graph.no-workflow-start", message, [])];
}

function unreachableNodes(context: AnalysisContext): readonly RuleViolation[] {
  const { graph } = context;
  if (graph.starts.length === 0) return [];
  const reachable = reachableFrom(graph.starts, graph.edges);
  return [...graph.nodes.keys()]
    .filter((name) => !reachable.has(name))
    .map((name) => {
      const message =
        `${name} is not reachable from any workflow start — lead a path to it, or remove it from ` +
        "the flow";
      return violation("graph.unreachable-node", message, [name]);
    });
}

/** A node other than a finish whose path stops at it: no next step, route or case leaves it. */
function deadEnds(context: AnalysisContext): readonly RuleViolation[] {
  const { graph } = context;
  const leaving = new Set(
    graph.edges.filter((edge) => edge.kind !== EdgeKind.Error).map((edge) => edge.from),
  );
  return [...graph.nodes.values()]
    .filter((node) => node.kind !== NodeKind.Finish && !leaving.has(node.name))
    .map((node) => {
      const message =
        `the path stops at ${node.name} — continue it with .to…(…), or end it with ` +
        ".toFinish(…); every path ends in a finish or at a shared node";
      return violation("graph.dead-end", message, [node.name]);
    });
}

export function graphRules(context: AnalysisContext): readonly RuleViolation[] {
  return [...noWorkflowStart(context), ...unreachableNodes(context), ...deadEnds(context)];
}

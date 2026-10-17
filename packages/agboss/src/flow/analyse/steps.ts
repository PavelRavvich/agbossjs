import { LimitExceededError } from "../../graph/limits.js";
import { violation, type RuleViolation } from "../../graph/rule-error.js";
import { NodeKind, type ErrorClass } from "../ast.js";
import type { ComponentName } from "../registry.js";
import { EdgeKind, type FlowGraph, type FlowNode } from "./flow-graph.js";
import type { AnalysisContext } from "./rules/context.js";

/**
 * `maxSteps` bounds at assembly (#261 AC17, two passes over the graph): for every node, the fewest
 * steps from a start up to it and including it, plus the fewest from it to a finish. Weights: an
 * agent or a router visit is 1; a start, an action and a finish are 0. A node with a handler of the
 * steps limit (`.onError(LimitExceededError, …)`) counts as reaching a finish: the visit past the
 * limit fails before it runs, into the handler. Only a hand-set
 * `maxSteps` is checked: the default always fits.
 */

const weightOf = (node: FlowNode | undefined): number =>
  node?.kind === NodeKind.Agent || node?.kind === NodeKind.Router ? 1 : 0;

/** Whether `.onError(error, …)` catches the steps limit (`LimitExceededError` or a parent class). */
const catchesStepsLimit = (error: ErrorClass | undefined): boolean =>
  error !== undefined &&
  (error === LimitExceededError || LimitExceededError.prototype instanceof error);

type Distances = ReadonlyMap<ComponentName, number>;

/** Fewest steps over `edges` from the `seeds` (with their own weights), each node's weight added. */
function shortest(
  graph: FlowGraph,
  seeds: ReadonlyMap<ComponentName, number>,
  edges: readonly (readonly [ComponentName, ComponentName])[],
): Distances {
  const distances = new Map(seeds);
  for (let changed = true; changed;) {
    changed = false;
    for (const [from, to] of edges) {
      const via = (distances.get(from) ?? Infinity) + weightOf(graph.nodes.get(to));
      if (via >= (distances.get(to) ?? Infinity)) continue;
      distances.set(to, via);
      changed = true;
    }
  }
  return distances;
}

const fromStart = (graph: FlowGraph, start: ComponentName): Distances =>
  shortest(
    graph,
    new Map([[start, 0]]),
    graph.edges.map((edge) => [edge.from, edge.to] as const),
  );

/** Fewest steps from each node to a finish, the node included. */
function toFinish(graph: FlowGraph): Distances {
  const seeds = new Map<ComponentName, number>();
  for (const node of graph.nodes.values())
    if (node.kind === NodeKind.Finish) seeds.set(node.name, 0);
  for (const edge of graph.edges) {
    if (catchesStepsLimit(edge.error)) seeds.set(edge.from, 0);
  }
  const exits = graph.edges.filter((edge) => edge.kind !== EdgeKind.Error);
  const reversed = exits.map((edge) => [edge.to, edge.from] as const);
  return shortest(graph, seeds, reversed);
}

/** The fewest steps of an execution through each node, from the given starts. */
function throughCounts(
  graph: FlowGraph,
  exits: Distances,
  starts: readonly ComponentName[],
): Distances {
  const least = new Map<ComponentName, number>();
  for (const start of starts) {
    for (const [node, before] of fromStart(graph, start)) {
      const exit = exits.get(node);
      if (exit === undefined) continue;
      const through = before + exit - weightOf(graph.nodes.get(node));
      least.set(node, Math.min(least.get(node) ?? Infinity, through));
    }
  }
  return least;
}

function boundViolations(graph: FlowGraph, maxSteps: number): readonly RuleViolation[] {
  const exits = toFinish(graph);
  const limit = String(maxSteps);
  const tooLow = graph.starts.flatMap((start) => {
    const steps = exits.get(start);
    if (steps === undefined || steps <= maxSteps) return [];
    const message = `the shortest path from ${start} takes ${String(steps)} steps, but maxSteps is ${limit}`;
    return [violation("limits.max-steps-too-low", message, [start])];
  });
  const fitting = graph.starts.filter((start) => (exits.get(start) ?? Infinity) <= maxSteps);
  const branches = [...throughCounts(graph, exits, fitting)]
    .filter(([node, steps]) => steps > maxSteps && weightOf(graph.nodes.get(node)) > 0)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([node, steps]) => {
      const message = `every path through ${node} takes at least ${String(steps)} steps, but maxSteps is ${limit}`;
      return violation("limits.branch-exceeds-max-steps", message, [node]);
    });
  return [...tooLow, ...branches];
}

export function stepsRules(context: AnalysisContext): readonly RuleViolation[] {
  const { maxSteps, name } = context.workflow;
  if (maxSteps === undefined) return [];
  const counted = [...context.graph.nodes.values()].some((node) => weightOf(node) > 0);
  if (counted) return boundViolations(context.graph, maxSteps);
  const message =
    `${name} has maxSteps: ${String(maxSteps)}, but it has no agent or router — steps are ` +
    "always 0; remove maxSteps";
  return [violation("limits.max-steps-unused", message, [])];
}

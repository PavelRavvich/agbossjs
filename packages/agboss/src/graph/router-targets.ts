import type { ChoiceTarget, ChooseStep, FlowNode } from "./flow.js";
import { routerMetaOf } from "./router.decorator.js";

const classOf = (source: FlowNode) => (typeof source === "function" ? source : source.use);

/**
 * The targets of the routers' `@Router({ routes })`, in their order, each once. A source that is not
 * a router adds none — the assembly reports it (`graph.choose-from-non-router`).
 */
export function routerTargets(sources: readonly FlowNode[]): readonly ChoiceTarget[] {
  const targets: ChoiceTarget[] = [];
  for (const source of sources) {
    for (const route of routerMetaOf(classOf(source))?.routes ?? []) {
      if (!targets.includes(route.target)) targets.push(route.target);
    }
  }
  return targets;
}

/**
 * `from(Router).routes()`: the targets are read when the flow is assembled, so a router declared
 * after the workflow in the same file still counts.
 */
export const routerChoice = (sources: readonly [FlowNode, ...FlowNode[]]): ChooseStep => ({
  kind: "choose",
  from: sources,
  get targets() {
    return routerTargets(sources);
  },
});

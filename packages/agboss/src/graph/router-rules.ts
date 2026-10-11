import { isSelf, isReturn, isEnd, labelOf } from "./flow.js";
import type { CollectedFlow, FlowNodeRef, NextDeclaration } from "./flow-nodes.js";
import type { PromptOptions } from "../components/prompt-options.js";

import type { RouteDeclaration } from "./route.js";
import { routerMetaOf, type RouterMeta } from "./router.decorator.js";
import { violation, type RuleViolation } from "./rule-error.js";
import { targetsOf } from "./rules.js";

const SELF_LABEL = "Self";

const hasText = (source: PromptOptions): boolean => {
  if (source.promptUrls && source.promptUrls.length > 0) return true;
  return (source.prompt ?? "").trim() !== "";
};

const routeHasText = (declaration: RouteDeclaration): boolean => hasText(declaration);

function textRules(router: FlowNodeRef, meta: RouterMeta): RuleViolation[] {
  const found: RuleViolation[] = [];
  if (!hasText(meta)) {
    const message = `router ${router.label} has no instructions`;
    found.push(violation("router.no-prompt", message, [router.label]));
  }
  for (const declaration of meta.routes.filter((item) => !routeHasText(item))) {
    const message = `router ${router.label}: the route to ${labelOf(declaration.target)} has no text`;
    found.push(violation("router.empty-route-text", message, [router.label]));
  }
  return found;
}

/** A route's key: the target node's key, `Self`, or the class label when it is not in the flow. */
import { isOptional, isParallel } from "./flow.js";
function routeKey(flow: CollectedFlow, declaration: RouteDeclaration): string {
  if (isSelf(declaration.target)) return SELF_LABEL;
  if (isReturn(declaration.target)) return "Return";
  if (isEnd(declaration.target)) return "End";
  if (isOptional(declaration.target) || isParallel(declaration.target))
    return labelOf(declaration.target);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-explicit-any
  return flow.keyOf(declaration.target as any) ?? labelOf(declaration.target);
}

function chooseKeys(
  next: NextDeclaration | undefined,
  flow: CollectedFlow,
  routerKey: string,
): string[] {
  if (next?.kind !== "choose") return [];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
  const step = flow.transitions.find((transition) => transition.from === routerKey)?.next as any;
  if (!step) return [];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  const parallelNames = step.parallelTargets
    ? // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return
      step.parallelTargets.map((p: any) => p.optionName)
    : [];

  // To get the non-parallel targets, we can look at step.targets, but they include the nodes inside parallel targets.
  // Actually, let's just use the router meta! Wait, router-rules validates meta against choose.
  // If we can't easily extract it from NextDeclaration, we can add `optionNames: string[]` to NextDeclaration in chooseTargets!
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return [
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/prefer-nullish-coalescing
    ...(step.optionNames || step.targets),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    ...parallelNames,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    ...(step.self ? [SELF_LABEL] : []),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    ...(step.return ? ["Return"] : []),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    ...(step.end ? ["End"] : []),
  ];
}

const chooseOf = (flow: CollectedFlow, routerKey: string): NextDeclaration | undefined =>
  flow.transitions.find((transition) => transition.from === routerKey)?.next;

function routesMismatch(
  flow: CollectedFlow,
  router: FlowNodeRef,
  meta: RouterMeta,
): RuleViolation[] {
  const routes = new Set(meta.routes.map((declaration) => routeKey(flow, declaration)));
  const chosen = new Set(chooseKeys(chooseOf(flow, router.key), flow, router.key));
  const missingRoutes = [...chosen].filter((key) => !routes.has(key));
  const extraRoutes = [...routes].filter((key) => !chosen.has(key));
  if (missingRoutes.length === 0 && extraRoutes.length === 0) return [];
  const labels = (keys: readonly string[]): string[] =>
    keys.map((key) => flow.nodes.get(key)?.label ?? key);
  const parts = [
    missingRoutes.length > 0 ? `no route for ${labels(missingRoutes).join(", ")}` : "",
    extraRoutes.length > 0
      ? `routes the other routers lack: ${labels(extraRoutes).join(", ")}`
      : "",
  ].filter((part) => part !== "");
  const message = `router ${router.label}: its routes differ from the shared from(…).routes() — ${parts.join("; ")}`;
  return [
    violation("router.routes-mismatch", message, [
      router.label,
      ...labels([...missingRoutes, ...extraRoutes]),
    ]),
  ];
}

/** Nodes with a transition into the node `key`. */
export const predecessorsOf = (flow: CollectedFlow, key: string): FlowNodeRef[] =>
  flow.transitions
    .filter((transition) => targetsOf(transition).includes(key))
    .flatMap((transition) => flow.nodes.get(transition.from) ?? []);

function selfWithoutAgent(
  flow: CollectedFlow,
  router: FlowNodeRef,
  meta: RouterMeta,
): RuleViolation[] {
  const usesSelf =
    meta.routes.some((declaration) => isSelf(declaration.target)) ||
    chooseKeys(chooseOf(flow, router.key), flow, router.key).includes(SELF_LABEL);
  if (!usesSelf) return [];
  const before = predecessorsOf(flow, router.key);
  const notAgents = before.filter((ref) => ref.kind !== "agent").map((ref) => ref.label);
  if (before.length > 0 && notAgents.length === 0) return [];
  const why =
    before.length === 0 ? "nothing comes before it" : `${notAgents.join(", ")} come(s) before it`;
  const message = `router ${router.label} routes to Self, but ${why} — Self needs an agent before the router`;
  return [violation("router.self-without-agent-before", message, [router.label, ...notAgents])];
}

/** Each router's texts, its routes against its `choose(...)`, and `Self`. */
export function routerRules(flow: CollectedFlow): RuleViolation[] {
  return [...flow.nodes.values()]
    .filter((ref) => ref.kind === "router")
    .flatMap((router) => {
      const meta = routerMetaOf(router.use);
      if (meta === undefined) return [];
      return [
        ...textRules(router, meta),
        ...routesMismatch(flow, router, meta),
        ...selfWithoutAgent(flow, router, meta),
      ];
    });
}

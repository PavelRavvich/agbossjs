import type { QuorumManager } from "../concurrency/quorum-manager.js";
import type { FlowModel } from "./check-flow.js";
import type { ChoiceTarget } from "./flow.js";
import type { FlowNodeRef } from "./flow-nodes.js";
import type { FlowRuntime } from "./build.js";
import type { FlowNodeRunner, QuorumContext } from "./visit.js";

/** The node a quorum strategy's target stands for: a class / named node by name, else its kind. */
const quorumTargetName = (target: ChoiceTarget): string =>
  typeof target === "string" ? target : "name" in target ? target.name : target.kind;

/** A quorum router: its strategy routes on whether the quorum is met. */
export function quorumRouterRunner(node: FlowNodeRef, runtime: FlowRuntime): FlowNodeRunner {
  return async (state, config) => {
    const strategy = runtime.quorumRouters?.(node.use.name);
    if (!strategy) throw new Error("Missing QuorumStrategy in AppDeps for " + node.use.name);

    let hasQuorum = false;
    const manager: unknown = config?.configurable?.quorumManager;
    if (manager) {
      hasQuorum = (manager as QuorumManager).isQuorumMet(node.key);
    }

    const target = await strategy.route(state, hasQuorum);
    return { next: quorumTargetName(target) };
  };
}

/** The quorum a node's `choose` waits for, when it is the source of a quorum route. */
export function quorumContextOf(model: FlowModel, node: FlowNodeRef): QuorumContext | undefined {
  const next = model.collected.transitions.find(
    (t) => t.from === node.key && t.next.kind === "choose" && t.next.quorumRouter,
  )?.next;
  if (next?.kind !== "choose" || !next.quorumRouter || next.quorumMin === undefined) {
    return undefined;
  }
  return {
    quorumId: next.quorumRouter,
    min: next.quorumMin,
    max: next.quorumMax,
    timeoutSeconds: next.quorumTimeoutSeconds,
    routerClass: next.quorumRouter,
  };
}

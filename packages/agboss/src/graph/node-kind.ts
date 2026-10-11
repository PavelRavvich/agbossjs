import type { Class } from "../components/injection.js";
import { componentOf } from "../components/metadata.js";

/** What a flow node is. Agents and routers are working nodes: their visits are steps. */
export type NodeKind =
  | "quorumRouter"
  | "workflow-start"
  | "router"
  | "agent"
  | "action"
  | "workflow-finish"
  | "workflow";

/** What the flow knows about a node class: its kind and its name (the graph node's name). */
export interface NodeInfo {
  readonly kind: NodeKind;
  readonly name: string;
}

const nodes = new WeakMap<Class, NodeInfo>();

/** Called by node decorators (`@Router`, and `@WorkflowStart` / `@WorkflowFinish`): marks a class as a flow node. */
export function recordNode(target: Class, info: NodeInfo): void {
  nodes.set(target, info);
}

/** A flow node's kind and name; `@Agent` classes are nodes too. Undefined for anything else. */
export function nodeInfoOf(target: Class): NodeInfo | undefined {
  const recorded = nodes.get(target);
  if (recorded !== undefined) return recorded;
  const component = componentOf(target);
  if (component?.kind === "agent") return { kind: "agent", name: component.meta.name };
  // Note: workflow meta has name inside meta.meta? Wait, componentOf(target).meta is WorkflowMeta! So component.meta.name
  if (component?.kind === "action") return { kind: "action", name: component.meta.name };
  if (component?.kind === "workflow")
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    return { kind: "workflow", name: (component.meta as any).name };
  return undefined;
}

export const isWorkingKind = (kind: NodeKind): boolean =>
  kind === "agent" || kind === "router" || kind === "action" || kind === "workflow";

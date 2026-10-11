import type { Class } from "../components/injection.js";
import { componentOf } from "../components/metadata.js";
import {
  isNamedNode,
  unwrapTarget,
  labelOf,
  type Flow,
  type FlowNode,
  type FlowStep,
} from "./flow.js";
import {
  batchParallelTransitions,
  catchTransitions,
  chooseTransitions,
  defined,
  joinTransitions,
  type Resolve,
} from "./flow-transitions.js";
import { nodeInfoOf, type NodeKind } from "./node-kind.js";
import { violation, type RuleViolation } from "./rule-error.js";

/**
 * A node's key in the flow — unique among its nodes. It is the node's name, except for a workflow
 * start: starts are never a step's target, so they have names of their own (`workflow-start.<name>`)
 * and a start and a finish may share a name (`chat` / `chat`).
 */
const flowKeyOf = (kind: NodeKind, name: string): string =>
  kind === "workflow-start" ? `${kind}.${name}` : name;

/** One node of the assembled flow: its key in the flow and its name (the declared one). */
export interface FlowNodeRef {
  readonly key: string;
  readonly name: string;
  readonly kind: NodeKind;
  readonly use: Class;
  readonly label: string;
}

/** A node's declared next step: one unconditional target, or a router's choice. */
export type NextDeclaration =
  | { readonly kind: "to"; readonly targets: readonly string[] }
  | { readonly kind: "catch"; readonly errorType: Class; readonly nextNode: string }
  | { readonly kind: "join"; readonly target: string; readonly joinSources: string[] }
  | {
      readonly kind: "batchParallel";
      readonly target: string;
      readonly strategy: Class;
      readonly options: { concurrencyLimit: number; batchSize: number };
    }
  | {
      readonly kind: "choose";
      readonly targets: readonly string[];
      readonly parallelTargets: readonly { optionName: string; targets: string[] }[];
      /** Option names in declaration order (parallel groups excluded). */
      readonly optionNames: readonly string[];
      readonly self: boolean;
      readonly return: boolean;
      readonly end: boolean;
      readonly quorumRouter?: string;
      readonly quorumMin?: number;
      readonly quorumMax?: number;
      readonly quorumTimeoutSeconds?: number;
    };

/** A declared next step of one node (both ends are node keys). */
export interface Transition {
  readonly from: string;
  readonly next: NextDeclaration;
}

/** Nodes (by key), transitions and node-level violations of a flow. */
export interface CollectedFlow {
  readonly nodes: ReadonlyMap<string, FlowNodeRef>;
  readonly transitions: readonly Transition[];
  readonly violations: readonly RuleViolation[];
  /** The node key of a class or named node, if it is a node of this flow. */
  readonly keyOf: (target: FlowNode) => string | undefined;
}

type Identity = FlowNode;

function duplicateViolation(taken: Identity, target: FlowNode, name: string): RuleViolation {
  const both = [labelOf(taken), labelOf(target)];
  return isNamedNode(taken) && isNamedNode(target)
    ? violation("graph.duplicate-node-name", `node name "${name}" is declared twice`, both)
    : violation("graph.duplicate-node", `two nodes are named "${name}": ${both.join(", ")}`, both);
}

/** Resolves every class / named node of the flow to a node once; records node-level violations. */
function createResolver() {
  const nodes = new Map<string, FlowNodeRef>();
  const owners = new Map<string, Identity>();
  const resolved = new Map<Identity, string | undefined>();
  const violations: RuleViolation[] = [];

  const register = (target: FlowNode): string | undefined => {
    const use = isNamedNode(target) ? target.use : target;
    const info = nodeInfoOf(use);
    if (info === undefined) {
      const message = `${labelOf(target)} is not a flow node (@WorkflowStart, @Router, @Agent or @WorkflowFinish)`;
      violations.push(violation("graph.not-a-node", message, [labelOf(target)]));
      return undefined;
    }
    const name = isNamedNode(target) ? target.name : info.name;
    const key = flowKeyOf(info.kind, name);
    const taken = owners.get(key);
    if (taken !== undefined) {
      // reported once; the duplicate stands for the same node, so no follow-up violations
      violations.push(duplicateViolation(taken, target, name));
      return key;
    }
    owners.set(key, target);
    nodes.set(key, { key, name, kind: info.kind, use, label: labelOf(target) });

    // Also register the compensation component so it's discovered by the container and agent builder
    const compMeta = componentOf(use);
    if (
      compMeta &&
      "meta" in compMeta &&
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      compMeta.meta &&
      "compensate" in compMeta.meta &&
      compMeta.meta.compensate
    ) {
      resolve(compMeta.meta.compensate);
    }

    return key;
  };

  const resolve = (target: FlowNode): string | undefined => {
    if (!resolved.has(target)) resolved.set(target, register(target));
    return resolved.get(target);
  };

  const lookup = (target: FlowNode): string | undefined => resolved.get(target);

  return { nodes, violations, resolve, lookup };
}

function transitionsOf(step: FlowStep, resolve: Resolve): Transition[] {
  switch (step.kind) {
    case "to": {
      const sources = defined(step.from.map(resolve));
      const targets = defined(step.targets.map((t) => resolve(unwrapTarget(t))));
      if (targets.length === 0) return [];

      return sources.map((from) => ({ from, next: { kind: "to", targets } }));
    }
    case "catch":
      return catchTransitions(step, resolve);
    case "join":
      return joinTransitions(step, resolve);
    case "choose":
      return chooseTransitions(step, resolve);
    case "batchParallel":
      return batchParallelTransitions(step, resolve);
    case "chain":
      return step.nodes.slice(1).flatMap((to, index) => {
        const source = step.nodes[index];
        return source === undefined
          ? []
          : transitionsOf({ kind: "to", from: [source], targets: [to] }, resolve);
      });
  }
  return [];
}

/** Every node and transition of the flow, in declaration order. */
export function collectFlow(flow: Flow): CollectedFlow {
  const resolver = createResolver();
  const transitions = flow.flatMap((step) => transitionsOf(step, resolver.resolve));
  return {
    nodes: resolver.nodes,
    transitions,
    violations: resolver.violations,
    keyOf: resolver.lookup,
  };
}

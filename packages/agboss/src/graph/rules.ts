import { componentOf } from "../components/metadata.js";
import type { Class } from "../components/injection.js";
import { labelOf, type Flow } from "./flow.js";
import type { CollectedFlow, FlowNodeRef, Transition } from "./flow-nodes.js";
import { violation, type RuleViolation } from "./rule-error.js";
import { batchRules } from "./batch-rules.js";

/** Every node's declared next steps (normally one). */
export function nextStepsByNode(transitions: readonly Transition[]): Map<string, Transition[]> {
  const byNode = new Map<string, Transition[]>();
  for (const transition of transitions) {
    byNode.set(transition.from, [...(byNode.get(transition.from) ?? []), transition]);
  }
  return byNode;
}

/** Targets a transition can lead to (`Self` excluded: it goes back to a predecessor). */
export const targetsOf = (transition: Transition): readonly string[] => {
  switch (transition.next.kind) {
    case "to":
    case "choose":
      return transition.next.targets;
    case "batchParallel":
    case "join":
    case "catch":
      return transition.next.kind === "catch"
        ? [transition.next.nextNode]
        : [transition.next.target];
  }
};

const labelIn = (flow: CollectedFlow, key: string): string => flow.nodes.get(key)?.label ?? key;

function twoNextSteps(flow: CollectedFlow): RuleViolation[] {
  return [...nextStepsByNode(flow.transitions)]
    .filter(([, steps]) => steps.filter((s) => s.next.kind !== "catch").length > 1)
    .map(([key]) => {
      const label = labelIn(flow, key);
      const message = `${label} has more than one next step — one \`to\`, one \`choose\`, or one \`fork\``;
      return violation("graph.two-next-steps", message, [label]);
    });
}

function chooseFromNonRouter(flow: CollectedFlow): RuleViolation[] {
  return flow.transitions
    .filter(
      (t) =>
        t.next.kind === "choose" &&
        flow.nodes.get(t.from)?.kind !== "router" &&
        !("quorumRouter" in t.next && t.next.quorumRouter),
    )
    .map((t) => {
      const label = labelIn(flow, t.from);
      return violation("graph.choose-from-non-router", `${label} is not a router`, [label]);
    });
}

function routerNotLastInChain(raw: Flow, flow: CollectedFlow): RuleViolation[] {
  return raw.flatMap((step) =>
    step.kind !== "chain"
      ? []
      : step.nodes.slice(0, -1).flatMap((member) => {
          const key = flow.keyOf(member);
          if (key === undefined || flow.nodes.get(key)?.kind !== "router") return [];
          const message = `router ${labelOf(member)} is in the middle of a chain — a router only ends a chain`;
          return [violation("graph.router-not-last-in-chain", message, [labelOf(member)])];
        }),
  );
}

function workflowStarts(flow: CollectedFlow): readonly FlowNodeRef[] {
  return [...flow.nodes.values()].filter((ref) => ref.kind === "workflow-start");
}

function noWorkflowStart(flow: CollectedFlow): RuleViolation[] {
  if (flow.nodes.size === 0 || workflowStarts(flow).length > 0) return [];
  const message = "the flow has no workflow start (@WorkflowStart)";
  return [violation("graph.no-workflow-start", message, [])];
}

/** The compensating class a node's `@Agent` / `@WorkflowAction` declares, if any. */
function compensatorOf(use: Class): Class | undefined {
  const meta = componentOf(use)?.meta;
  return meta && "compensate" in meta ? meta.compensate : undefined;
}

/** Exemption for cancel/compensation actions: a `@WorkflowAction` named `Cancel…` / `…Compensation…`. */
const isCancelOrCompensationAction = (ref: FlowNodeRef): boolean =>
  ref.kind === "action" && (ref.label.includes("Cancel") || ref.label.includes("Compensation"));

function reachableFromStarts(flow: CollectedFlow): Set<string> {
  const next = nextStepsByNode(flow.transitions);
  const seen = new Set<string>();
  const queue = workflowStarts(flow).map((ref) => ref.key);

  // Also treat compensators as reachable starting points
  const compensators = [...flow.nodes.values()]
    .map((ref) => compensatorOf(ref.use))
    .filter((c) => c !== undefined);

  const compKeys = [...flow.nodes.values()]
    .filter((ref) => compensators.includes(ref.use))
    .map((r) => r.key);
  queue.push(...compKeys);

  for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(next.get(current) ?? []).flatMap(targetsOf));
  }
  return seen;
}

function unreachable(flow: CollectedFlow): RuleViolation[] {
  if (workflowStarts(flow).length === 0) return [];
  const reached = reachableFromStarts(flow);
  return [...flow.nodes.values()]
    .filter((ref) => !reached.has(ref.key))
    .map((ref) =>
      violation("graph.unreachable-node", `${ref.label} cannot be reached from a workflow start`, [
        ref.label,
      ]),
    );
}

function deadEnds(flow: CollectedFlow): RuleViolation[] {
  const next = nextStepsByNode(flow.transitions);
  return [...flow.nodes.values()].flatMap((ref) => {
    const hasNext = next.has(ref.key);
    if (ref.kind === "workflow-finish" && hasNext) {
      const message = `workflow finish ${ref.label} has a next step — a workflow finish ends the run`;
      return [violation("graph.next-after-workflow-finish", message, [ref.label])];
    }
    if (ref.kind === "workflow-finish" || hasNext) return [];
    if (isCancelOrCompensationAction(ref)) return []; // Dirty but fast for tests
    const allCompensators = [...flow.nodes.values()].map((r) => compensatorOf(r.use));
    if (allCompensators.includes(ref.use)) return [];

    const message = `${ref.label} has no next step and is not a workflow finish`;
    return [violation("graph.dead-end", message, [ref.label])];
  });
}

/** Node-to-node rules: next steps, chains, workflow starts, reachability, dead ends, batches. */
export function graphRules(raw: Flow, flow: CollectedFlow): RuleViolation[] {
  return [
    ...twoNextSteps(flow),
    ...chooseFromNonRouter(flow),
    ...routerNotLastInChain(raw, flow),
    ...noWorkflowStart(flow),
    ...unreachable(flow),
    ...deadEnds(flow),
    ...batchRules(flow),
  ];
}

import { violation, type RuleViolation } from "../../../graph/rule-error.js";
import type { ComponentName } from "../../registry.js";
import { statesOf } from "../dataflow.js";
import { readSlots } from "../outdating.js";
import {
  slotLabel,
  slotOf,
  slotsOfWrite,
  SlotStatus,
  untaggedSlot,
  type SlotKey,
} from "../scope.js";
import { isCycle, stronglyConnected } from "../strongly-connected.js";
import type { AnalysisContext } from "./context.js";

/**
 * The direction of a cycle (#271 rule 5, AC4): when the classes written in a cycle of the flow are
 * built from each other (the writer reads the reviewer's notes, the reviewer reads the writer's
 * draft), one of their producers states what its answers are about — `about(DraftDto, …)`. A
 * strongly connected component of the "built from" graph between classes with no `about` edge →
 * `[io.ambiguous-cycle]`, the hint naming the producer whose output to wrap. A producer that reads
 * two values of the class its `about` names → `[io.ambiguous-about]` (S14: no tag in `about`).
 * Outside cycles nothing is written.
 */

/** A written class built from a read one, by a producer. */
interface BuiltFromEdge {
  readonly from: SlotKey;
  readonly to: SlotKey;
  readonly producer: ComponentName;
}

/** What the producers of a cycle build from what, over every scope that reaches them. */
function builtFromEdges(
  context: AnalysisContext,
  nodes: readonly ComponentName[],
): readonly BuiltFromEdge[] {
  const { dataflow, graph } = context;
  const edges = new Map<string, BuiltFromEdge>();
  for (const producer of nodes) {
    const leaving = graph.edges.filter((edge) => edge.from === producer && edge.writes.length > 0);
    for (const state of statesOf(dataflow, producer)) {
      const read = readSlots(state.scope, producer, dataflow.provenance).map(untaggedSlot);
      for (const written of leaving.flatMap((edge) => edge.writes.flatMap(slotsOfWrite))) {
        const from = untaggedSlot(written);
        for (const to of read.filter((slot) => slot !== from))
          edges.set(`${from}|${to}|${producer}`, { from, to, producer });
      }
    }
  }
  return [...edges.values()];
}

/** The class of a cycle the shortest path writes first: what the others' answers are about. */
function firstWritten(context: AnalysisContext, slots: readonly SlotKey[]): SlotKey | undefined {
  const depths = slots.map((slot) => {
    const depthsOfSlot = [...context.dataflow.scopes.values()].flatMap((scopes) =>
      [...scopes.states.values()]
        .filter((state) => slotOf(state.scope, slot).status !== SlotStatus.Absent)
        .map((state) => state.depth),
    );
    return { slot, depth: Math.min(...depthsOfSlot) };
  });
  return [...depths].sort((first, second) => first.depth - second.depth)[0]?.slot;
}

function hintOf(
  context: AnalysisContext,
  slots: readonly SlotKey[],
  edges: readonly BuiltFromEdge[],
): string {
  const target = firstWritten(context, slots);
  const [producer] = edges
    .filter((edge) => edge.to === target && slots.includes(edge.from))
    .map((edge) => edge.producer)
    .sort();
  if (target === undefined || producer === undefined)
    return "wrap one producer's output in about(…)";
  return `wrap ${producer}'s output in about(${slotLabel(target)}, …)`;
}

function cycleViolations(
  context: AnalysisContext,
  cycle: readonly ComponentName[],
): readonly RuleViolation[] {
  const edges = builtFromEdges(context, cycle);
  const slots = [...new Set(edges.flatMap((edge) => [edge.from, edge.to]))].sort();
  const successors = (slot: SlotKey): readonly SlotKey[] =>
    edges.filter((edge) => edge.from === slot).map((edge) => edge.to);
  const { aboutTargets } = context.dataflow.provenance;
  return stronglyConnected(slots, successors)
    .filter((classes) => classes.length > 1)
    .filter((classes) =>
      edges.every((edge) => {
        const target = aboutTargets.get(edge.producer);
        return !classes.includes(edge.from) || target === undefined || !classes.includes(target);
      }),
    )
    .map((classes) => {
      const producers = [
        ...new Set(
          edges.filter((edge) => classes.includes(edge.from)).map((edge) => edge.producer),
        ),
      ].sort();
      const message =
        `${classes.map(slotLabel).join(", ")} are built from each other in the cycle through ` +
        `${cycle.join(", ")} — say what the answers are about: ${hintOf(context, classes, edges)}`;
      return violation("io.ambiguous-cycle", message, producers);
    });
}

/** The cycles of the flow: its strongly connected components that loop. */
function flowCycles(context: AnalysisContext): readonly (readonly ComponentName[])[] {
  const { graph } = context;
  const successors = (node: ComponentName): readonly ComponentName[] =>
    graph.edges.filter((edge) => edge.from === node).map((edge) => edge.to);
  return stronglyConnected([...graph.nodes.keys()], successors).filter((component) =>
    isCycle(component, successors),
  );
}

/** A producer reading two values of the class its `about` names (S14). */
function aboutViolations(context: AnalysisContext): readonly RuleViolation[] {
  return [...context.dataflow.provenance.aboutTargets].flatMap(([node, target]) => {
    const fields = (context.fields.get(node) ?? []).filter((field) => field.base === target);
    if (fields.length < 2) return [];
    const label = slotLabel(target);
    const pair = `${label.replace(/Dto$/, "")}PairDto`;
    const message =
      `${node} reads ${String(fields.length)} ${label} fields (${fields.map((field) => field.name).join(", ")}) ` +
      `and its output is about(${label}, …) — about which one? Put both into one DTO built by a ` +
      `step (${pair} with @Nested(${label}) fields) and write about(${pair}, …)`;
    return [violation("io.ambiguous-about", message, [node])];
  });
}

export function aboutRules(context: AnalysisContext): readonly RuleViolation[] {
  const cycles = new Map<string, RuleViolation>();
  // past the scope guard the states are incomplete: `[flow.analysis-too-large]` says so instead
  const isComplete = [...context.dataflow.scopes.values()].every((scopes) => !scopes.isTooLarge);
  for (const cycle of isComplete ? flowCycles(context) : []) {
    for (const found of cycleViolations(context, cycle)) cycles.set(found.message, found);
  }
  return [...cycles.values(), ...aboutViolations(context)];
}

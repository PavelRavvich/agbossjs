import { NodeKind } from "../ast.js";
import type { InputFieldShape, InputFields } from "../decorators/declaration.js";
import type { ComponentName } from "../registry.js";
import { reachableFrom, type FlowGraph, type FlowNode } from "./flow-graph.js";
import { shapeLabel } from "./labels.js";
import { slotOfField, slotsOfValue, taggedSlot, writtenValue, type SlotKey } from "./scope.js";

/**
 * Which slot each input field reads (#270 → a tag narrows, rule 2): `name: XDto` reads the tag
 * `name` when some path into its node brings an `XDto` tagged `{ as: "name" }`, else `latest`. A tag
 * slot is never overwritten by another tag, so "some path brings it" is reachability: a tagged
 * write on an edge whose target reaches the node. A finish without `input` reads the latest value of
 * its `output` type (Q50) — never a tag.
 */

export interface ResolvedField {
  /** The field name; for a pass-through finish, the name of its output DTO. */
  readonly name: string;
  /** How messages name it: `answer-agent.message (WorkflowStartTextDto)`. */
  readonly label: string;
  readonly shape: InputFieldShape;
  /** The slot it reads: its shape's own slot (`latest`) or that slot's tag. */
  readonly slot: SlotKey;
  /** Its shape's own slot, before the tag. */
  readonly base: SlotKey;
  readonly tag?: string;
  readonly isRequired: boolean;
  readonly isList: boolean;
  /** The output of a finish without `input`: not a field of `InputOf<X>`. */
  readonly isPassThrough: boolean;
}

/** The fields a node reads from the path scope, as declared. */
function declaredFields(node: FlowNode): InputFields | undefined {
  const { declaration } = node;
  switch (declaration.kind) {
    case NodeKind.Agent:
    case NodeKind.Action:
    case NodeKind.Router:
    case NodeKind.Finish:
      return declaration.options.input;
    default:
      return undefined;
  }
}

/** The tag slots that reach each node on some path from a start. */
function tagsReaching(graph: FlowGraph): ReadonlyMap<ComponentName, ReadonlySet<SlotKey>> {
  const reachable = reachableFrom(graph.starts, graph.edges);
  const byNode = new Map<ComponentName, Set<SlotKey>>();
  for (const edge of graph.edges) {
    if (!reachable.has(edge.from)) continue;
    const tagged = edge.writes.flatMap((write) => {
      const { tag } = write;
      if (tag === undefined) return [];
      return slotsOfValue(writtenValue(write.shape).value).map((slot) => taggedSlot(slot, tag));
    });
    if (tagged.length === 0) continue;
    for (const node of reachableFrom([edge.to], graph.edges)) {
      const slots = byNode.get(node) ?? new Set<SlotKey>();
      for (const slot of tagged) slots.add(slot);
      byNode.set(node, slots);
    }
  }
  return byNode;
}

function resolveField(
  node: FlowNode,
  name: string,
  shape: InputFieldShape,
  tags: ReadonlySet<SlotKey>,
): ResolvedField {
  const { slot: base, isRequired, isList } = slotOfField(shape);
  const tagged = taggedSlot(base, name);
  const label = `${node.name}.${name} (${shapeLabel(shape)})`;
  const common = { name, label, shape, base, isRequired, isList, isPassThrough: false };
  return tags.has(tagged) ? { ...common, slot: tagged, tag: name } : { ...common, slot: base };
}

/** A pass-through finish reads the latest value of its `output` type. */
function passThroughField(node: FlowNode): ResolvedField | undefined {
  const { declaration } = node;
  if (declaration.kind !== NodeKind.Finish || declaration.options.input !== undefined)
    return undefined;
  const { output } = declaration.options;
  const { slot } = slotOfField(output);
  const label = `${node.name} (${shapeLabel(output)})`;
  return {
    name: output.name,
    label,
    shape: output,
    slot,
    base: slot,
    isRequired: true,
    isList: false,
    isPassThrough: true,
  };
}

/** The resolved fields of every node that reads the path scope. */
export function resolveFields(
  graph: FlowGraph,
): ReadonlyMap<ComponentName, readonly ResolvedField[]> {
  const tags = tagsReaching(graph);
  const byNode = new Map<ComponentName, readonly ResolvedField[]>();
  for (const node of graph.nodes.values()) {
    const passThrough = passThroughField(node);
    if (passThrough !== undefined) {
      byNode.set(node.name, [passThrough]);
      continue;
    }
    const fields = declaredFields(node);
    if (fields === undefined) continue;
    const nodeTags = tags.get(node.name) ?? new Set<SlotKey>();
    byNode.set(
      node.name,
      Object.entries(fields).map(([name, shape]) => resolveField(node, name, shape, nodeTags)),
    );
  }
  return byNode;
}

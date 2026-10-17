import type { DtoClass } from "../../dto/types.js";
import type { ResolvedField } from "../analyse/fields.js";
import type { ValueWrite } from "../analyse/flow-graph.js";
import { slotOfField, slotsOfValue, taggedSlot, writtenValue } from "../analyse/scope.js";
import { NodeKind } from "../ast.js";
import { isFieldMap } from "../decorators/declaration.js";
import { Wrapper, withVariant, type ListWrapper, type ProducedValue } from "../dto-wrappers.js";
import type { RuntimeGraph, RuntimeNode } from "./graph-model.js";
import {
  valueIdOf,
  type ScopeRecords,
  type ScopeValueRecord,
  type VariantElement,
} from "./records.js";

/**
 * The path scope at run time (#270 → path scope, #271 S11): a node's outgoing edge writes its values
 * into their slots (a write replaces `latest` and its own tag only), and a node reads its `input`
 * fields from their slots, each rebuilt into `{ producer, value }` with the producer's class.
 */

/** What a visit of a node gave: its value and, for a `oneOf`, the class it is. */
export interface NodeValue {
  readonly value: unknown;
  readonly variant?: string;
}

/** Where a visit writes: which node, which visit, and what it read. */
export interface WriteSite {
  readonly node: RuntimeNode;
  readonly visitNumber: number;
  readonly builtFrom: readonly string[];
}

/** A map start's field values by their slot, so `.returns(A, optional(B))` finds each. */
function startFieldValue(node: RuntimeNode, write: ValueWrite, given: NodeValue): unknown {
  const { declaration } = node;
  if (declaration.kind !== NodeKind.Start) return given.value;
  const { input } = declaration.options;
  if (!isFieldMap(input)) return given.value;
  const [slot] = slotsOfValue(writtenValue(write.shape).value);
  const field = Object.entries(input).find(([, shape]) => slotOfField(shape).slot === slot);
  const values = given.value as Readonly<Record<string, unknown>>;
  return field === undefined ? undefined : values[field[0]];
}

const elementClassOf = (list: ListWrapper): DtoClass | undefined =>
  typeof list.element === "function" ? list.element : undefined;

/** The value a slot of a list holds: the whole list, or the elements of one class of a `oneOf`. */
function listSlotValue(slot: string, list: ListWrapper, value: unknown): unknown {
  if (elementClassOf(list) !== undefined || !Array.isArray(value)) return value;
  const elements = value as readonly VariantElement[];
  if (slot.startsWith("list:oneOf(")) return elements;
  const className = slot.slice("list:".length);
  return elements.filter((element) => element.variant === className).map((e) => e.value);
}

/** The records one write puts into the scope. */
function writeRecords(site: WriteSite, write: ValueWrite, given: NodeValue): ScopeValueRecord[] {
  const { value: shape, isOptional } = writtenValue(write.shape);
  const value = startFieldValue(site.node, write, given);
  if (isOptional && value === undefined) return [];
  const slots = slotsOfValue(shape);
  const all =
    write.tag === undefined
      ? slots
      : [...slots, ...slots.map((s) => taggedSlot(s, write.tag ?? ""))];
  return all.map((slot) => {
    const base = slot.split("#")[0] ?? slot;
    const slotValue = typeof shape === "function" ? value : listSlotValue(base, shape, value);
    const variant = typeof shape === "function" ? given.variant : undefined;
    return {
      valueId: valueIdOf(site.node.id, site.visitNumber, slot),
      slot,
      producer: site.node.id,
      ...(variant === undefined ? {} : { variant }),
      value: slotValue,
      builtFrom: site.builtFrom,
    };
  });
}

/** What an edge writes for a visit, by slot. */
export function recordsOfWrites(
  site: WriteSite,
  writes: readonly ValueWrite[],
  given: NodeValue,
): ScopeRecords {
  const records = writes.flatMap((write) => writeRecords(site, write, given));
  return Object.fromEntries(records.map((record) => [record.slot, record]));
}

/** A node's input as its handler or its model reads it: `Produced` fields, and what was read. */
export interface ReadInput {
  readonly fields: Readonly<Record<string, unknown>>;
  /** The `valueId`s read (the `builtFrom` of what the node writes). */
  readonly read: readonly string[];
}

/** Rebuilds one value of a slot into `{ producer, value }` (with its class for a `oneOf`). */
function produced(graph: RuntimeGraph, producer: string, value: unknown, variant?: string) {
  const item: ProducedValue<unknown, unknown> = {
    producer: graph.nodes.get(producer)?.component,
    value,
  };
  const dto = variant === undefined ? undefined : graph.dtos.get(variant);
  return dto === undefined ? item : withVariant(item, dto);
}

function fieldValue(graph: RuntimeGraph, field: ResolvedField, record: ScopeValueRecord): unknown {
  if (!field.isList || !Array.isArray(record.value)) {
    return produced(graph, record.producer, record.value, record.variant);
  }
  const isOneOf = record.slot.startsWith("list:oneOf(");
  return (record.value as readonly unknown[]).map((element) =>
    isOneOf
      ? produced(
          graph,
          record.producer,
          (element as VariantElement).value,
          (element as VariantElement).variant,
        )
      : produced(graph, record.producer, element),
  );
}

/** Reads a node's fields from the scope; an absent `optional` field is `undefined`. */
export function readInput(graph: RuntimeGraph, node: RuntimeNode, scope: ScopeRecords): ReadInput {
  const fields: Record<string, unknown> = {};
  const read: string[] = [];
  for (const field of node.fields) {
    const record = scope[field.slot];
    if (record === undefined) continue;
    fields[field.name] = fieldValue(graph, field, record);
    read.push(record.valueId);
  }
  return { fields, read: [...new Set(read)].sort() };
}

/** Whether an output shape is a list (its value is an array). */
export const isListOutput = (shape: unknown): boolean =>
  typeof shape === "object" && shape !== null && "kind" in shape && shape.kind === Wrapper.List;

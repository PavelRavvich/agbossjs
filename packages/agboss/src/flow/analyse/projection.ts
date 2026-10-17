import type { ComponentName } from "../registry.js";
import type { ResolvedField } from "./fields.js";
import { slotOf, SlotStatus, type AbstractScope } from "./scope.js";

/**
 * The shapes of a node's input (#272 S4, S10): every reachable abstract scope projected onto the
 * node's `input` fields, duplicates removed. Scopes that differ only in slots the node does not
 * read give one shape. Type generation (PR 3) prints them as the exact union of `InputOf<X>` (up to
 * 32 shapes, flat above).
 */

/** One field of one input shape: who can have written it, or absent (`producers` empty). */
export interface ProjectedField {
  readonly name: string;
  readonly isPresent: boolean;
  readonly producers: readonly ComponentName[];
}

/** One way the node's input can look. */
export type InputShape = readonly ProjectedField[];

function project(scope: AbstractScope, fields: readonly ResolvedField[]): InputShape {
  return fields
    .filter((field) => !field.isPassThrough)
    .map((field): ProjectedField => {
      const state = slotOf(scope, field.slot);
      const isPresent = state.status !== SlotStatus.Absent;
      return { name: field.name, isPresent, producers: isPresent ? state.producers : [] };
    });
}

const shapeKey = (shape: InputShape): string => JSON.stringify(shape);

/** The distinct input shapes of a node, in a canonical order. */
export function projectInput(
  scopes: readonly AbstractScope[],
  fields: readonly ResolvedField[],
): readonly InputShape[] {
  const shapes = new Map<string, InputShape>();
  for (const scope of scopes) {
    const shape = project(scope, fields);
    shapes.set(shapeKey(shape), shape);
  }
  return [...shapes]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([, shape]) => shape);
}

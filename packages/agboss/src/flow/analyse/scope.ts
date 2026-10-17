import type { DtoClass } from "../../dto/types.js";
import type { Brand } from "../../types/brand.js";
import type { InputFieldShape } from "../decorators/declaration.js";
import { Wrapper, type ListWrapper, type ValueShape } from "../dto-wrappers.js";
import type { ComponentName } from "../registry.js";
import type { ValueWrite } from "./flow-graph.js";
import { dtoLabel, sortedVariants } from "./labels.js";

/**
 * The abstract path scope (#272 S10, #270 → path scope): one reachable state of an execution's
 * scope, slot by slot. A slot is keyed by shape (S5): `OfferDraftDto`, `list:CompanyScoreDto`, and
 * per tag `OfferDraftDto#before`; `XDto` and `listOf(XDto)` never share a slot. A write replaces
 * `latest` and its own tag only. Scopes are never merged slot by slot, so the correlation between
 * fields survives (`{ fast }` or `{ expert }`, never neither).
 */

/** A slot's state on one reachable scope. #271 adds outdating (`Outdated`, read from `builtFrom`). */
export enum SlotStatus {
  Absent = "absent",
  Current = "current",
  Outdated = "outdated",
}

/** A slot of the path scope (S5): `OfferDraftDto`, `list:CompanyScoreDto`, `OfferDraftDto#before`. */
export type SlotKey = Brand<string, "SlotKey">;

export interface SlotState {
  readonly status: SlotStatus;
  /** Who wrote the value (component names, sorted); several only for several values at once. */
  readonly producers: readonly ComponentName[];
  /** The slots the producer read when it built the value (#271 outdates through them). */
  readonly builtFrom: readonly SlotKey[];
  /** How many values one step put in the slot (more than one: `[input.several-on-path]`). */
  readonly count: number;
}

/** One reachable state of the path scope: the slots that hold a value, by key. */
export type AbstractScope = ReadonlyMap<SlotKey, SlotState>;

export const EMPTY_SCOPE: AbstractScope = new Map();

const ABSENT: SlotState = { status: SlotStatus.Absent, producers: [], builtFrom: [], count: 0 };

/** A slot's state; `Absent` when the scope holds no value there. */
export const slotOf = (scope: AbstractScope, key: SlotKey): SlotState => scope.get(key) ?? ABSENT;

/** A structural key: two scopes with the same slots and states are one abstract scope. */
export function scopeKey(scope: AbstractScope): string {
  return JSON.stringify([...scope].sort(([first], [second]) => first.localeCompare(second)));
}

const key = (text: string): SlotKey => text as SlotKey;

/** The tag slot of a slot: `OfferDraftDto#before`. */
export const taggedSlot = (slot: SlotKey, tag: string): SlotKey => key(`${slot}#${tag}`);

/** The slot a list of `oneOf` values is kept in as a whole: `list:oneOf(ADto,BDto)`. */
const oneOfListSlot = (list: ListWrapper): SlotKey =>
  typeof list.element === "function"
    ? key(`list:${dtoLabel(list.element)}`)
    : key(`list:oneOf(${sortedVariants(list.element).map(dtoLabel).join(",")})`);

/**
 * The slots a value fills: `XDto` → `XDto`; `listOf(XDto)` → `list:XDto`; `listOf(oneOf(A, B))` →
 * the whole list and the elements of each class (`list:A`, `list:B`, #270 "the XDto elements").
 */
export function slotsOfValue(shape: DtoClass | ListWrapper): readonly SlotKey[] {
  if (typeof shape === "function") return [key(dtoLabel(shape))];
  if (typeof shape.element === "function") return [oneOfListSlot(shape)];
  const elements = sortedVariants(shape.element).map((dto) => key(`list:${dtoLabel(dto)}`));
  return [oneOfListSlot(shape), ...elements];
}

/** The slot an input field reads before tags (its shape's own slot), and whether it is required. */
export interface FieldSlot {
  readonly slot: SlotKey;
  readonly isRequired: boolean;
  readonly isList: boolean;
}

export function slotOfField(shape: InputFieldShape): FieldSlot {
  if (typeof shape === "function")
    return { slot: key(dtoLabel(shape)), isRequired: true, isList: false };
  if (shape.kind === Wrapper.List)
    return { slot: oneOfListSlot(shape), isRequired: true, isList: true };
  return { ...slotOfField(shape.inner), isRequired: false };
}

/** The value inside a `.returns(…)` shape, and whether a path may not bring it. */
export interface WrittenValue {
  readonly value: DtoClass | ListWrapper;
  readonly isOptional: boolean;
}

export const writtenValue = (shape: ValueShape): WrittenValue =>
  typeof shape !== "function" && shape.kind === Wrapper.Optional
    ? { value: shape.inner, isOptional: true }
    : { value: shape, isOptional: false };

/** The slots one write fills: its value's slots and, with a tag, their tag slots. */
const slotsOfWrite = (write: ValueWrite): readonly SlotKey[] => {
  const slots = slotsOfValue(writtenValue(write.shape).value);
  return write.tag === undefined
    ? slots
    : [...slots, ...slots.map((slot) => taggedSlot(slot, write.tag ?? ""))];
};

/** What a producer's values carry besides the slots: who wrote them and what they were built from. */
export interface WriteOrigin {
  readonly producer: ComponentName;
  readonly builtFrom: readonly SlotKey[];
}

/** Every subset of the optional writes is a separate reachable scope (path-sensitive). */
function presentCombinations(writes: readonly ValueWrite[]): readonly (readonly ValueWrite[])[] {
  return writes.reduce<readonly (readonly ValueWrite[])[]>(
    (combinations, write) =>
      writtenValue(write.shape).isOptional
        ? combinations.flatMap((present) => [present, [...present, write]])
        : combinations.map((present) => [...present, write]),
    [[]],
  );
}

/** The scopes after an edge writes its values (one per combination of optional values). */
export function afterWrites(
  scope: AbstractScope,
  writes: readonly ValueWrite[],
  origin: WriteOrigin,
): readonly AbstractScope[] {
  if (writes.length === 0) return [scope];
  return presentCombinations(writes).map((present) => {
    const counts = new Map<SlotKey, number>();
    for (const slot of present.flatMap(slotsOfWrite)) counts.set(slot, (counts.get(slot) ?? 0) + 1);
    const next = new Map(scope);
    for (const [slot, count] of counts) {
      next.set(slot, {
        status: SlotStatus.Current,
        producers: [origin.producer],
        builtFrom: origin.builtFrom,
        count,
      });
    }
    return next;
  });
}

/**
 * What an execution keeps of its data, as plain JSON (#270 S5, #271 S11): one record per slot of
 * the path scope, keyed by the slot (`OfferDraftDto`, `list:CompanyScoreDto`, `OfferDraftDto#before`).
 * A record is rebuilt into `Produced<T, P>` on read from the registries (producer by `name`, variant
 * by DTO class name), so it survives a serialising checkpointer.
 */

/** A component as an execution record names it: by its `name` only, never by its class (Q42). */
export interface ComponentRecord {
  readonly name: string;
}

/** One element of a `listOf(oneOf(…))` value: its class and the value (#271 S11, 2026-10-17). */
export interface VariantElement {
  readonly variant: string;
  readonly value: unknown;
}

/** The current value of one slot of the path scope. */
export interface ScopeValueRecord {
  /** `${nodeId}:${visitNumber}/${slot}` — deterministic, the same in tests and after a resume. */
  readonly valueId: string;
  readonly slot: string;
  /** The `name` of the component that gave the value. */
  readonly producer: string;
  /** The DTO class name of a `oneOf` value. */
  readonly variant?: string;
  /** The value; a list slot holds an array (of `VariantElement`s for `listOf(oneOf(…))`). */
  readonly value: unknown;
  /** The `valueId`s the producer read when it built the value (#271 outdates through them). */
  readonly builtFrom: readonly string[];
}

/** A value moved out of the scope (#271 adds the outdating step; empty until then, S11). */
export interface OutdatedValueRecord extends ScopeValueRecord {
  readonly outdated: { readonly byValueId: string };
}

/** The path scope of one execution: the current record of each slot. */
export type ScopeRecords = Readonly<Record<string, ScopeValueRecord>>;

/** The `valueId` of a slot written at a node's visit. */
export const valueIdOf = (nodeId: string, visitNumber: number, slot: string): string =>
  `${nodeId}:${String(visitNumber)}/${slot}`;

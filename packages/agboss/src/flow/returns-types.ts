import type { AfterValue, PathHead, ReturnsOptions } from "./builder-types.js";
import type { ValueOf, ValueShape } from "./dto-wrappers.js";
import type { GeneratedTypeError, NameOf } from "./generated-types.js";

/**
 * The types of `.returns(…)` (#272 AC2, AC15): what the step gives, from the generated
 * `ProducerOutputs`. A producer that gives several values at once — a start whose `input` is a map
 * of fields (#270 AC21), later a join (#273) — is a tuple there, one member per value in declaration
 * order (`readonly [CompanyDto, SearchRequestDto | undefined]`); `.returns(A, optional(B))` must
 * name the same values, in any order (assembly compares them as a set too).
 */

export type Same<TFirst, TSecond> = [TFirst] extends [TSecond]
  ? [TSecond] extends [TFirst]
    ? true
    : false
  : false;

/** Whether an output is several values at once (a tuple in `ProducerOutputs`). */
export type IsSeveral<TOutput> = TOutput extends readonly unknown[]
  ? number extends TOutput["length"]
    ? false
    : true
  : false;

/** One value of a set, kept whole: `B | undefined` stays one member when the set is a union. */
interface Member<TValue> {
  readonly value: TValue;
}

type Members<TValues extends readonly unknown[]> = {
  [K in keyof TValues]: Member<TValues[K]>;
}[number];

type IsIn<TMember, TMembers> = TMembers extends unknown ? Same<TMember, TMembers> : never;

type AllIn<TValues extends readonly unknown[], TOthers extends readonly unknown[]> = false extends {
  [K in keyof TValues]: true extends IsIn<Member<TValues[K]>, Members<TOthers>> ? true : false;
}[number]
  ? false
  : true;

/** Two lists of values with the same members, in any order. */
export type SameValues<
  TFirst extends readonly unknown[],
  TSecond extends readonly unknown[],
> = TFirst["length"] extends TSecond["length"]
  ? AllIn<TFirst, TSecond> extends true
    ? AllIn<TSecond, TFirst>
    : false
  : false;

/** The values `.returns(A, optional(B), …)` names. */
export type ValuesOf<TShapes extends readonly ValueShape[]> = {
  -readonly [K in keyof TShapes]: ValueOf<TShapes[K]>;
};

interface NotGiven<TName extends string> {
  readonly __error: `not what ${TName} gives — see ProducerOutputs["${TName}"]`;
}

/** `.returns(X)`: `unknown` when `X` is what the step gives, else a readable error. */
export type ReturnsCheck<TValue, TOutput, TName extends string> = [TOutput] extends [
  GeneratedTypeError,
]
  ? TOutput
  : IsSeveral<TOutput> extends true
    ? { readonly __error: `${TName} gives several values — name each of them in .returns(…)` }
    : Same<TValue, TOutput> extends true
      ? unknown
      : NotGiven<TName>;

/** `.returns(A, optional(B), …)`: `unknown` when the values are what the step gives. */
export type SeveralReturnsCheck<
  TValues extends readonly unknown[],
  TOutput,
  TName extends string,
> = [TOutput] extends [GeneratedTypeError]
  ? TOutput
  : TOutput extends readonly unknown[]
    ? IsSeveral<TOutput> extends true
      ? SameValues<TValues, TOutput> extends true
        ? unknown
        : NotGiven<TName>
      : NotGiven<TName>
    : NotGiven<TName>;

/** Several values at once: two or more shapes. */
export type SeveralShapes = readonly [ValueShape, ValueShape, ...ValueShape[]];

export interface Returning<TInstance, TOutput, THead extends PathHead> {
  returns<const TShape extends ValueShape>(
    value: TShape & ReturnsCheck<ValueOf<TShape>, TOutput, NameOf<TInstance>>,
    options?: ReturnsOptions,
  ): AfterValue<ValueOf<TShape>, THead>;
  returns<const TShapes extends SeveralShapes>(
    ...values: TShapes & SeveralReturnsCheck<ValuesOf<TShapes>, TOutput, NameOf<TInstance>>
  ): AfterValue<ValuesOf<TShapes>, THead>;
}

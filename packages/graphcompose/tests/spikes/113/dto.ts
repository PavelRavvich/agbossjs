/**
 * Spike #113 — DTO field decorators (standard TC39 decorators). Not framework API.
 *
 * How the type check works: a field decorator gets `ClassFieldDecoratorContext<This, Value>` where
 * `Value` is the declared field type, and may return an initializer `(value: Value) => Value`.
 * Returning `(value: T) => T` for the decorator's own `T` makes the compiler demand `Value` ≡ `T`
 * both ways (parameter + return), so `@Text` on a `number`, a missing `optional: true` on `x?:`
 * and a `@OneOf` whose `values` differ from the field's union are all compile errors.
 */

/** Node 26 still has no `Symbol.metadata`; without it TypeScript's emit passes `context.metadata = undefined`. */
const symbols = Symbol as { metadata?: symbol };
symbols.metadata ??= Symbol.for("Symbol.metadata");
const METADATA: symbol = symbols.metadata;

export type FieldKind = "text" | "integer" | "flag" | "one-of" | "list-of" | "nested";

/** What one field decorator records for the framework (the runtime half of the check). */
export interface FieldSpec {
  readonly kind: FieldKind;
  readonly prompt?: string;
  readonly optional: boolean;
  readonly values?: readonly string[];
  readonly item?: DtoClass;
}

export type DtoClass<T = object> = abstract new () => T;

interface CommonOptions {
  readonly prompt?: string;
  readonly sensitive?: "redact" | "mask";
}
interface Optional {
  readonly optional: true;
}

/** The decorator a factory returns for fields of exactly type `T`. */
type FieldDecorator<T> = <This>(
  value: undefined,
  context: ClassFieldDecoratorContext<This, T>,
) => (initial: T) => T;

const FIELDS = Symbol("graphcompose.spike.fields");

type FieldTable = Record<string, FieldSpec>;

function fieldsIn(metadata: DecoratorMetadataObject): FieldTable {
  const own = Object.hasOwn(metadata, FIELDS) ? (metadata[FIELDS] as FieldTable) : undefined;
  if (own !== undefined) return own;
  const table: FieldTable = {};
  metadata[FIELDS] = table;
  return table;
}

function field<T>(spec: Omit<FieldSpec, "optional">, optional: boolean): FieldDecorator<T> {
  return (_value, context) => {
    // `undefined` when nothing set `Symbol.metadata` before the class was defined (see the top).
    if (context.metadata === undefined) throw new Error("Symbol.metadata is not available");
    fieldsIn(context.metadata)[String(context.name)] = { ...spec, optional };
    return (initial) => initial;
  };
}

const isOptional = (options: object): boolean => "optional" in options && options.optional === true;

export function Text(options: CommonOptions & Optional): FieldDecorator<string | undefined>;
export function Text(options?: CommonOptions): FieldDecorator<string>;
export function Text(
  options: CommonOptions = {},
): FieldDecorator<string> | FieldDecorator<string | undefined> {
  return field<string | undefined>({ kind: "text", ...options }, isOptional(options));
}

export function Integer(options: CommonOptions & Optional): FieldDecorator<number | undefined>;
export function Integer(options?: CommonOptions): FieldDecorator<number>;
export function Integer(
  options: CommonOptions = {},
): FieldDecorator<number> | FieldDecorator<number | undefined> {
  return field<number | undefined>({ kind: "integer", ...options }, isOptional(options));
}

export function Flag(options?: CommonOptions): FieldDecorator<boolean> {
  return field({ kind: "flag", ...options }, false);
}

/** `values` is inferred as a tuple of literals; the field must be exactly their union. */
export function OneOf<const V extends readonly string[]>(
  options: CommonOptions & { readonly values: V },
): FieldDecorator<V[number]> {
  return field({ kind: "one-of", ...options }, false);
}

export function ListOf<T extends object>(
  item: DtoClass<T>,
  options: CommonOptions = {},
): FieldDecorator<T[]> {
  return field({ kind: "list-of", item, ...options }, false);
}

export function Nested<T extends object>(
  item: DtoClass<T>,
  options: CommonOptions = {},
): FieldDecorator<T> {
  return field({ kind: "nested", item, ...options }, false);
}

/** Reads a DTO's fields back (what `@Tool({ input })` would turn into a zod schema). */
export function fieldsOf(dto: DtoClass): Readonly<FieldTable> {
  const metadata = (dto as unknown as Record<symbol, DecoratorMetadataObject | null | undefined>)[
    METADATA
  ];
  return metadata === null || metadata === undefined ? {} : fieldsIn(metadata);
}

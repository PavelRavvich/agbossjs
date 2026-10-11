declare const brand: unique symbol;

/**
 * Nominal type over a primitive: a `ModelId` cannot be passed where a `ThreadId` is expected,
 * even though both are strings at runtime. Apply the brand once, at a validated boundary.
 */
export type Brand<TValue, TName extends string> = TValue & { readonly [brand]: TName };

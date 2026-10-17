/**
 * An object without its `undefined` fields: optional fields stay absent under
 * `exactOptionalPropertyTypes`, so records keep one shape whatever was left out.
 */
export const withoutUndefined = <TValue extends object>(value: TValue): TValue =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as TValue;

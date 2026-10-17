/**
 * JSON with sorted object keys (#270 AC9): the same value is always the same bytes, so a request's
 * static part (tool schemas) and the input message stay cache-stable whatever order an object was
 * built in (an MCP server listing its tools in another order after a reconnect changes nothing).
 */

const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value).sort(([first], [second]) =>
    first < second ? -1 : first > second ? 1 : 0,
  );
  return Object.fromEntries(entries.map(([key, inner]) => [key, sortValue(inner)]));
};

/** A deep copy of a JSON value with every object's keys sorted. */
export const withSortedKeys = <TValue>(value: TValue): TValue => sortValue(value) as TValue;

/** One-line JSON with sorted keys; `undefined` reads as `null`. */
export const sortedJson = (value: unknown): string => JSON.stringify(sortValue(value) ?? null);

/** Indented JSON with sorted keys (the input message). */
export const prettyJson = (value: unknown): string =>
  JSON.stringify(sortValue(value) ?? null, null, 2);

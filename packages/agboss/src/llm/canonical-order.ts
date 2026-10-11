/**
 * The canonical order of what a model sees by name (tools, routes): declaration order changes
 * neither the request nor its fingerprint. Plain code-unit order, the same in every locale.
 */
export const compareNames = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

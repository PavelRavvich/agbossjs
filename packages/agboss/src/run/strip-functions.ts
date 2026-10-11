// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-explicit-any
export const stripFunctions = (obj: any): any => {
  if (typeof obj === "function") return "[Function]";
  if (Array.isArray(obj)) return obj.map(stripFunctions);
  if (obj !== null && typeof obj === "object") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const next: Record<string, any> = {};
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    for (const [k, v] of Object.entries(obj)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      next[k] = stripFunctions(v);
    }
    return next;
  }
  return obj;
};

import { vi, type Mocked } from "vitest";
import type { Class } from "../components/injection.js";

/** Method names along a prototype chain (without `constructor`). */
function methodNames(prototype: unknown): Set<string> {
  const names = new Set<string>();
  let current: unknown = prototype;
  while (typeof current === "object" && current !== null && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (name !== "constructor" && typeof descriptor?.value === "function") names.add(name);
    }
    current = Object.getPrototypeOf(current);
  }
  return names;
}

/**
 * A typed mock of a class: every method a `vi.fn()` (returning undefined until a test sets it),
 * `instanceof` still true. No constructor runs, so a mock has no dependencies and no lifecycle.
 */
export function mockInstanceOf<T>(cls: Class<T>): Mocked<T> {
  const prototype: unknown = cls.prototype;
  const mock: Record<string, unknown> = Object.create(
    typeof prototype === "object" ? prototype : null,
  ) as Record<string, unknown>;
  for (const name of methodNames(prototype)) mock[name] = vi.fn();
  // built above from the class's own prototype: every method replaced by a vi.fn()
  return mock as Mocked<T>;
}

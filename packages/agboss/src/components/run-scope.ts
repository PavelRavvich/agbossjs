import { AsyncLocalStorage } from "node:async_hooks";
import { tokenName, type Class, type Token } from "./injection.js";
import { destroyAll } from "./lifecycle.js";
import { ComponentError } from "./metadata.js";

/**
 * Run scope (#184): a run-scoped component (`scope: "run"`) gets one instance per run, created in
 * the run's child container of the app's container and destroyed (`onDestroy`) when the run ends.
 */

/** A run's child container: run-scoped instances of its own, everything else from the app's. */
export interface RunContainer {
  readonly get: (token: Token) => unknown;
  /** The run-scoped instances it created, dependencies first. */
  readonly created: readonly unknown[];
}

/** A container that can open a child for a run. */
export interface ScopeOwner {
  readonly runChild: () => RunContainer;
}

class RunScope {
  private readonly children = new Map<ScopeOwner, RunContainer>();

  childOf(owner: ScopeOwner): RunContainer {
    const existing = this.children.get(owner);
    if (existing !== undefined) return existing;
    const child = owner.runChild();
    this.children.set(owner, child);
    return child;
  }

  async dispose(): Promise<void> {
    await destroyAll([...this.children.values()].flatMap((child) => child.created));
  }
}

const runs = new AsyncLocalStorage<RunScope>();

/**
 * Runs `work` as one run: its run-scoped instances are its own (concurrent runs never share them)
 * and are destroyed when it ends. A failing `onDestroy` fails the run only when the run succeeded.
 */
export async function inRunScope<T>(work: () => Promise<T>): Promise<T> {
  const scope = new RunScope();
  let result: T;
  try {
    result = await runs.run(scope, work);
  } catch (error) {
    await scope.dispose().catch(() => undefined);
    throw error;
  }
  await scope.dispose();
  return result;
}

const currentRun = (cls: Class): RunScope => {
  const scope = runs.getStore();
  if (scope === undefined) {
    throw new ComponentError(
      `[di.run-scope-outside-run] ${tokenName(cls)} is run-scoped (scope: "run"): it exists only during a run (app.execute / app.resume)`,
    );
  }
  return scope;
};

/**
 * What the app's container hands out for a run-scoped class: a stand-in that forwards every use to
 * the current run's instance (the framework's tool, action, … lookups are built once per app).
 */
export function runScopedProxy(cls: Class, owner: ScopeOwner): object {
  const current = (): object => currentRun(cls).childOf(owner).get(cls) as object;
  const prototype: unknown = cls.prototype;
  return new Proxy(Object.create(prototype as object | null) as object, {
    get: (_target, prop) => {
      // not a promise: `await`ing the stand-in must not look up a run
      if (prop === "then") return undefined;
      const instance = current();
      const value: unknown = Reflect.get(instance, prop, instance);
      return typeof value === "function" ? (value as () => unknown).bind(instance) : value;
    },
    set: (_target, prop, value) => Reflect.set(current(), prop, value),
    has: (_target, prop) => Reflect.has(current(), prop),
  });
}

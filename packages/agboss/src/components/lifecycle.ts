/**
 * Lifecycle hooks of components the container creates (services, tools, knowledge bases): `onStart`
 * runs when the app is built, `onStop` when it is closed. Values and test mocks have no hooks.
 */
export interface OnInit {
  onInit(): Promise<void> | void;
}

export interface AfterAssemble {
  afterAssemble(): Promise<void> | void;
}

export interface OnStart {
  onStart(): Promise<void> | void;
}

export interface OnStop {
  onStop(): Promise<void> | void;
}

const hasHook = <THook extends "onInit" | "afterAssemble" | "onStart" | "onStop" | "onDestroy">(
  instance: unknown,
  hook: THook,
): instance is Record<THook, () => Promise<void> | void> =>
  typeof instance === "object" &&
  instance !== null &&
  typeof Reflect.get(instance, hook) === "function";

/** `onInit` of every instance that has it, in creation order. */
export async function initAll(instances: readonly unknown[]): Promise<void> {
  for (const instance of instances) {
    if (hasHook(instance, "onInit")) await instance.onInit();
  }
}

/** `afterAssemble` of every instance that has it, in creation order. */
export async function assembleAll(instances: readonly unknown[]): Promise<void> {
  for (const instance of instances) {
    if (hasHook(instance, "afterAssemble")) await instance.afterAssemble();
  }
}

/** `onStart` of every instance that has it, in creation order (dependencies first). */
export async function startAll(instances: readonly unknown[]): Promise<void> {
  for (const instance of instances) {
    if (hasHook(instance, "onStart")) await instance.onStart();
  }
}

/** `onStop` of every instance that has it, dependants first; every hook runs even when one fails. */
export async function stopAll(instances: readonly unknown[]): Promise<void> {
  const failures: unknown[] = [];
  for (const instance of [...instances].reverse()) {
    if (!hasHook(instance, "onStop")) continue;
    try {
      await instance.onStop();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "onStop failed");
}

/** Called on a run-scoped instance (`scope: "run"`) when its run ends — answered, paused or failed. */
export interface OnDestroy {
  onDestroy(): Promise<void> | void;
}

/** `onDestroy` of every instance that has it, dependants first; every hook runs even when one fails. */
export async function destroyAll(instances: readonly unknown[]): Promise<void> {
  const failures: unknown[] = [];
  for (const instance of [...instances].reverse()) {
    if (!hasHook(instance, "onDestroy")) continue;
    try {
      await instance.onDestroy();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "onDestroy failed");
}

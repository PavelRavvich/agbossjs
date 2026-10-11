import type { Class } from "../components/injection.js";

export interface BatchParallelStrategyOptions {
  name?: string;
}

export interface BatchParallelStrategyMeta extends BatchParallelStrategyOptions {
  name: string;
}

const batchParallelStrategies = new WeakMap<Class, BatchParallelStrategyMeta>();

export function BatchParallelStrategy(options?: BatchParallelStrategyOptions) {
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  return function (target: Class) {
    batchParallelStrategies.set(target, { name: options?.name ?? target.name, ...options });
  };
}

export const batchParallelStrategyMetaOf = (target: Class): BatchParallelStrategyMeta | undefined =>
  batchParallelStrategies.get(target);

export interface BatchParallelStrategy<TState, TItem> {
  extract(state: TState): TItem[];
}

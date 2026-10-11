import type { BuiltApp } from "../app/create-app.js";
import type { App, ExecutionOutput } from "../app/types.js";
import type { FlowNode } from "../graph/flow.js";
import type { TestClock } from "./clock.js";
import type { TestEnvironment } from "./environment.js";
import { TestFailure } from "./errors.js";
import {
  agentSlice,
  routerSlice,
  toolSlice,
  type AgentSlice,
  type RouterSlice,
  type ToolClassOf,
  type ToolSlice,
} from "./slices.js";

/**
 * The app of a test: the same `run` / `resume` as in production, built on first use (so `mockOf`
 * in the test body still takes effect), plus the test's clock and slices of single components.
 * A blocked live call or a script problem fails the call, even when the run swallowed it; any call
 * after `close()` (or `recoverApp()`) fails with `test.app-closed`.
 */
export interface TestApp extends Pick<App, "execute" | "resume" | "close" | "cancel"> {
  readonly clock: TestClock;
  agent(agent: FlowNode): AgentSlice;
  router(router: FlowNode): RouterSlice;
  tool<TInput, TOutput>(tool: ToolClassOf<TInput, TOutput>): ToolSlice<TInput, TOutput>;
}

/** Rethrows what the test must see: a reported failure wins over the run's own error. */
async function checked<T>(environment: TestEnvironment, work: () => Promise<T>): Promise<T> {
  let value: T;
  try {
    value = await work();
  } catch (error) {
    throw environment.book.takeFailure() ?? error;
  }
  const failure = environment.book.takeFailure();
  if (failure !== undefined) throw failure;
  return value;
}

export function createTestApp(environment: TestEnvironment): TestApp {
  let building: Promise<BuiltApp> | undefined;
  let closed = false;
  const built = (): Promise<BuiltApp> => {
    if (closed) {
      const message = "this app is closed — after recoverApp() use the app it returned";
      return Promise.reject(new TestFailure("test.app-closed", message));
    }
    return (building ??= environment.newApp());
  };
  return {
    clock: environment.clock,
    execute: (start, input, options) =>
      checked(environment, async () => (await built()).app.execute(start, input, options)),
    resume: (thread, decision, options): Promise<ExecutionOutput> =>
      checked(environment, async () => (await built()).app.resume(thread, decision, options)),
    cancel: (thread, options) =>
      checked(environment, async () => (await built()).app.cancel(thread, options)),
    close: async () => {
      closed = true;
      if (building !== undefined) await (await building).app.close();
    },
    agent: (agent) => ({
      replyWith: (task) =>
        checked(environment, async () => agentSlice(await built(), agent).replyWith(task)),
    }),
    router: (router) => ({
      routeTo: (input) =>
        checked(environment, async () => routerSlice(await built(), router).routeTo(input)),
    }),
    tool: (tool) => ({
      invoke: (input) =>
        checked(environment, async () => toolSlice(await built(), tool).invoke(input)),
    }),
  };
}

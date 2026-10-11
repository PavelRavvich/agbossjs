import { newRunContext, type RunContext } from "../core/run-context.js";

/**
 * A `RunContext` for a tool or action called directly in a unit test (`ctx.run`): run `test`, its
 * own thread, a signal nobody aborts and no metadata and no start input unless given.
 */
export function testRunContext(
  context: {
    readonly runId?: string;
    readonly threadId?: string;
    readonly signal?: AbortSignal;
    readonly metadata?: Readonly<Record<string, string>>;
    readonly input?: Readonly<Record<string, unknown>>;
  } = {},
): RunContext {
  return newRunContext({ runId: "test", ...context });
}

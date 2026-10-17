import type { GraphDeps } from "../../../graph/deps.js";
import { runGuards } from "../guards.js";
import type { NodeRunner } from "../node-runner.js";

/**
 * A workflow start: its input guards on the validated input, which is its value — written to the
 * scope by its path's `.returns(…)` (`start(S).returns(InputDto)`).
 */
export function startRunner(deps: GraphDeps<string>): NodeRunner {
  return async (state) => {
    const usage = await runGuards(deps.guards.input, state.startInput);
    return { value: { value: state.startInput }, read: [], usage };
  };
}

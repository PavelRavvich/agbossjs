import { extractRunContext } from "../../../core/run-context.js";
import { defaultSummaries } from "../../../graph/agent-definitions.js";
import type { GraphDeps } from "../../../graph/deps.js";
import type { RouteRequest, RouterEngine } from "../../../routers/index.js";
import type { RuntimeNode } from "../graph-model.js";
import { formatMemory } from "../history.js";
import { inputMessageOf } from "../input-message.js";
import type { NodeRunner } from "../node-runner.js";
import { RouterDecisionError } from "../router-error.js";
import type { LoadedRouter } from "../routers.js";
import { readInput } from "../scope.js";
import type { ExecutionStateType } from "../state.js";

/** The router's request: its static texts, the thread's memory, then its input message (#270 Q51). */
function requestOf(
  router: LoadedRouter,
  node: RuntimeNode,
  state: ExecutionStateType,
  deps: GraphDeps<string>,
): RouteRequest {
  const memory = formatMemory(state, {
    summaries: defaultSummaries(deps.config),
    turns: deps.config.defaults.history.limit,
  });
  const input = inputMessageOf(node.fields, state.scope);
  return {
    input: memory === "" ? input : `${memory}\n\n${input}`,
    options: router.routes.map((route) => ({ name: route.option, description: route.condition })),
    instructions: router.instructions,
  };
}

/**
 * A model router (`DecidedBy.Model`, #272): its model decides on its `input` only — never the whole
 * path scope — through the decision gateway. A failed decision fails the step with
 * `RouterDecisionError` (its spend kept); an unknown route fails it the same way (`router.unknown-route`).
 */
export function routerRunner(
  node: RuntimeNode,
  router: LoadedRouter,
  engine: RouterEngine,
  deps: GraphDeps<string>,
): NodeRunner {
  return async (state, config) => {
    const threadId = extractRunContext(config, state.runId).threadId;
    const appState = { runId: state.runId, threadId, activeNode: node.id };
    const request = requestOf(router, node, state, deps);
    const input = typeof request.input === "string" ? request.input : JSON.stringify(request.input);
    await deps.observer?.onRouterStart({ name: node.id, input, state: appState });
    const outcome = await engine.route(request);
    const usage = outcome.usage === undefined ? [] : [outcome.usage];
    if (outcome.kind === "failed") {
      const code = outcome.unknownOption === undefined ? "router.failed" : "router.unknown-route";
      throw new RouterDecisionError(node.id, code, outcome.reason, usage);
    }
    const { next, reason } = outcome.decision;
    await deps.observer?.onRouterEnd({
      name: node.id,
      update: { route: next, reason },
      state: appState,
    });
    return { route: next, read: readInput(deps.graph, node, state.scope).read, usage };
  };
}

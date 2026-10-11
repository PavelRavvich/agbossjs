import type { UsageRecord } from "../../finops/usage.js";
import type { RouteOutcome, RouteRequest, RouterEngine } from "../../routers/index.js";
import { formatMemory, renderRouteInput } from "../contributions.js";
import { PaidStepError } from "../errors.js";
import type { FlowStateType, FlowStateUpdate } from "../flow-state.js";
import { SELF_OPTION } from "../route.js";
import type { LoadedRouter } from "../router-texts.js";
import type { AsyncNode } from "../types.js";
import { normalisePromptText } from "../text.js";
import type { PromptInput } from "../../components/prompt-input.js";
import { extractRunContext } from "../../core/run-context.js";

/** How much of the thread's memory a router sees. */
export interface MemoryLimits {
  readonly summaries: number;
  readonly turns: number;
}

export interface FlowRouterNodeDeps {
  readonly router: RouterEngine;
  readonly loaded: LoadedRouter;
  readonly memory: MemoryLimits;
  /** The router's route to a workflow finish, if it has one: taken without a call after an approval decision. */
  readonly finish?: string;
}

/** Why a router sent the turn to its workflow finish without asking its model (#100). */
export const AFTER_APPROVAL_DECISION = "the agent answered after the approval decision";

/** Why a router could not routeTo: its model call failed, or it chose something that is not a route. */
export type RouterFailureCode = "router.failed" | "router.unknown-route";

/** A router could not routeTo — the run fails (no guessing); its spend is kept. */
export class RouterDecisionError extends PaidStepError {
  static override readonly code: string = "step.router";
  override name = "RouterDecisionError";
  /** Why the decision failed (refines the class's code `RouterDecisionError.code`, `step.router`). */
  override readonly code: RouterFailureCode;
  readonly router: string;

  constructor(
    router: string,
    code: RouterFailureCode,
    reason: string,
    usage: readonly UsageRecord[],
  ) {
    super(`Router "${router}" [${code}]: ${reason}`, usage, undefined, { router, reason: code });
    this.code = code;
    this.router = router;
  }
}

async function resolvePrompt(input: PromptInput, state: FlowStateType): Promise<string> {
  return normalisePromptText(await input(state));
}

/** Routes in canonical order (already sorted at load) as the router's options. */
export async function routeRequestOf(
  state: FlowStateType,
  deps: FlowRouterNodeDeps,
): Promise<RouteRequest> {
  const instructions = await resolvePrompt(deps.loaded.instructions, state);
  const options = await Promise.all(
    deps.loaded.routes.map(async (item) => ({
      name: item.option,
      description: await resolvePrompt(item.condition, state),
    })),
  );
  return {
    input: renderRouteInput(state.task, state.contributions, formatMemory(state, deps.memory)),
    options,
    instructions,
  };
}

/** The node the router chose: a route's target, or for `Self` the previous agent. */
function targetOf(
  outcome: Extract<RouteOutcome, { kind: "decided" }>,
  state: FlowStateType,
  deps: FlowRouterNodeDeps,
  usage: readonly UsageRecord[],
): { next: string; optionalBranches: readonly string[] } {
  const { next } = outcome.decision;
  const fail = (code: RouterFailureCode, reason: string): never => {
    throw new RouterDecisionError(deps.loaded.name, code, reason, usage);
  };
  const route = deps.loaded.routes.find((item) => item.option === next);
  if (!route) {
    return fail("router.unknown-route", `"${next}" is not one of its routes`);
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  if (next !== SELF_OPTION) return { next, optionalBranches: route.optionalBranches || [] };
  return state.previousAgent === ""
    ? fail("router.failed", "Self, but no agent ran yet")
    : { next: state.previousAgent, optionalBranches: [] };
}

/** A flow router: asks the router's model, fails the run on any failure, sets `next` to the target. */
import type { ObserverManager } from "../../core/observer-manager.js";

export function makeFlowRouterNode(
  deps: FlowRouterNodeDeps & { observer?: ObserverManager },
): AsyncNode<FlowStateType, FlowStateUpdate> {
  return async (state, config) => {
    // a call was decided in this turn and the agent has answered since — the turn ends (#100)
    if (state.approvals.length > 0 && deps.finish !== undefined) {
      return { next: deps.finish, routeReason: AFTER_APPROVAL_DECISION };
    }
    const appState = {
      runId: state.runId,
      threadId: extractRunContext(config, state.runId).threadId,
      activeNode: deps.loaded.name,
      variables: {},
      history: state.history,
    };
    await deps.observer?.onRouterStart({
      name: deps.loaded.name,
      input: state.task,
      state: appState,
    });
    const request = await routeRequestOf(state, deps);
    const outcome = await deps.router.route(request);
    const usage = outcome.usage === undefined ? [] : [outcome.usage];
    if (outcome.kind === "failed") {
      const code = outcome.unknownOption === undefined ? "router.failed" : "router.unknown-route";
      throw new RouterDecisionError(deps.loaded.name, code, outcome.reason, usage);
    }
    const target = targetOf(outcome, state, deps, usage);
    const result = {
      next: target.next,
      optionalBranches: target.optionalBranches as string[],
      routeReason: outcome.decision.reason,
      usage,
    };
    await deps.observer?.onRouterEnd({ name: deps.loaded.name, update: result, state: appState });
    return result;
  };
}

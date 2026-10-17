import { totalCost } from "../../finops/usage.js";
import { limitError, type LimitBreach, type ResolvedLimits } from "../../graph/limits.js";
import { NodeKind } from "../ast.js";
import { VisitsLimitExceededError } from "./errors.js";
import type { RuntimeNode } from "./graph-model.js";
import type { ExecutionStateType } from "./state.js";

/**
 * What is checked before an agent or a router runs (#272 AC14, QUALITY → FinOps): the steps of the
 * execution (`maxSteps`), the node's own `maxVisits`, the run's and the day's money. Crossing any
 * fails the visit before the node runs — no model call — into that node's `.onError`, else the
 * execution fails.
 */

/** Agents and routers are steps; starts, actions and finishes are not. */
export const isWorkingNode = (node: RuntimeNode): boolean =>
  node.kind === NodeKind.Agent || node.kind === NodeKind.Router;

function breachOf(
  state: ExecutionStateType,
  limits: ResolvedLimits,
  daySpentBeforeRunUsd: number,
): LimitBreach | undefined {
  const steps = state.steps + 1;
  if (steps > limits.steps) return { key: "maxSteps", limit: limits.steps, actual: steps };
  const spent = totalCost(state.usage);
  if (limits.runCostUsd !== undefined && spent >= limits.runCostUsd) {
    return { key: "limits.perRun.cost", limit: limits.runCostUsd, actual: spent };
  }
  const today = daySpentBeforeRunUsd + spent;
  if (limits.dayCostUsd !== undefined && today >= limits.dayCostUsd) {
    return { key: "limits.perDay.cost", limit: limits.dayCostUsd, actual: today };
  }
  return undefined;
}

/** Throws the limit a visit of this working node would cross. */
export function checkVisit(
  state: ExecutionStateType,
  node: RuntimeNode,
  limits: ResolvedLimits,
  daySpentBeforeRunUsd: number,
): void {
  const path = [...state.path, node.id];
  const spent = totalCost(state.usage);
  const visits = (state.visits[node.id] ?? 0) + 1;
  if (node.maxVisits !== undefined && visits > node.maxVisits) {
    throw new VisitsLimitExceededError(node.id, node.maxVisits, path, spent);
  }
  const breach = breachOf(state, limits, daySpentBeforeRunUsd);
  if (breach !== undefined) throw limitError(breach, path, spent);
}

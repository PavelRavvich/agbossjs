import { isGraphInterrupt } from "@langchain/langgraph";
import { errorRecordOf } from "../../core/error-record.js";
import type { UsageRecord } from "../../finops/usage.js";
import { PaidStepError } from "../../graph/errors.js";
import { LimitExceededError, type ResolvedLimits } from "../../graph/limits.js";
import type { FlowEdge } from "../analyse/flow-graph.js";
import { errorHandlerOf, type RuntimeNode } from "./graph-model.js";
import { checkVisit, isWorkingNode } from "./limits.js";
import type { GraphNode, NodeOutcome, NodeRunner } from "./node-runner.js";
import { OutputInvalidError } from "./errors.js";
import { RouterDecisionError } from "./router-error.js";
import { recordsOfWrites } from "./scope.js";
import type { ExecutionStateType, ExecutionStateUpdate } from "./state.js";

/**
 * A node's visit (#272 → Runtime): limits checked before an agent or a router runs, the node run,
 * its way out chosen — the router's route, the `switch` case of its value's class, its one next step,
 * or the end at a finish — and its value written to the scope on that edge. A failure goes to the
 * node's most specific `.onError` handler as a plain record in state (it holds after a resume);
 * without one the execution fails with the error as it is.
 */

/** The workflow's spend today, read once per execution (for `limits.perDay.cost`). */
export type SpentToday = () => Promise<number>;

export interface VisitDeps {
  readonly limits: ResolvedLimits;
  readonly spentToday: SpentToday;
}

async function daySpentBeforeRun(state: ExecutionStateType, deps: VisitDeps): Promise<number> {
  if (state.daySpentBeforeRunUsd !== null) return state.daySpentBeforeRunUsd;
  return deps.limits.dayCostUsd === undefined ? 0 : deps.spentToday();
}

/** The edge a visit leaves by; `undefined` at a finish (the execution ends). */
function exitOf(node: RuntimeNode, outcome: NodeOutcome): FlowEdge | undefined {
  const { exits } = node;
  if (outcome.route !== undefined) {
    const route = exits.routes.get(outcome.route);
    if (route !== undefined) return route;
    const reason = `"${outcome.route}" is not one of its routes`;
    throw new RouterDecisionError(node.id, "router.unknown-route", reason, outcome.usage ?? []);
  }
  if (exits.cases.size > 0) {
    const variant = outcome.value?.variant ?? "";
    const branch = exits.cases.get(variant);
    if (branch !== undefined) return branch;
    throw new OutputInvalidError(
      `${node.id} gave ${variant || "no class"}, which its switch has no caseOf(…) for`,
    );
  }
  return exits.next;
}

/** Spend a failure carries that the execution's state does not hold yet. */
const unrecordedSpendOf = (error: unknown): readonly UsageRecord[] =>
  error instanceof PaidStepError || error instanceof LimitExceededError ? error.usage : [];

function visited(node: RuntimeNode, isStep: boolean): ExecutionStateUpdate {
  return { path: [node.id], visits: { [node.id]: 1 }, steps: isStep ? 1 : 0 };
}

function succeeded(
  node: RuntimeNode,
  state: ExecutionStateType,
  outcome: NodeOutcome,
): ExecutionStateUpdate {
  const exit = exitOf(node, outcome);
  const site = { node, visitNumber: (state.visits[node.id] ?? 0) + 1, builtFrom: outcome.read };
  const scope =
    exit === undefined
      ? {}
      : recordsOfWrites(site, exit.writes, outcome.value ?? { value: undefined });
  return {
    ...visited(node, isWorkingNode(node)),
    scope,
    next: exit?.to ?? "",
    usage: [...(outcome.usage ?? [])],
    approvals: [...(outcome.approvals ?? [])],
    ...(outcome.finish === undefined ? {} : { finish: node.id, output: outcome.finish.output }),
  };
}

/** A failure the node's `.onError` takes: kept as a record, the side path next; else rethrown. */
function caught(node: RuntimeNode, error: unknown, ranAsStep: boolean): ExecutionStateUpdate {
  if (isGraphInterrupt(error)) throw error;
  const record = errorRecordOf(error);
  const handler = errorHandlerOf(node.exits, record);
  if (handler === undefined) throw error;
  return {
    ...visited(node, ranAsStep),
    lastError: record,
    next: handler.to,
    usage: [...unrecordedSpendOf(error)],
  };
}

/** Wraps a node's runner with the execution's bookkeeping. */
export function visitNode(node: RuntimeNode, runner: NodeRunner, deps: VisitDeps): GraphNode {
  return async (state, config) => {
    let ranAsStep = false;
    let daySpent: number | null = state.daySpentBeforeRunUsd;
    try {
      if (isWorkingNode(node)) {
        daySpent = await daySpentBeforeRun(state, deps);
        checkVisit(state, node, deps.limits, daySpent);
        ranAsStep = true;
      }
      const outcome = await runner(state, config);
      return { ...succeeded(node, state, outcome), daySpentBeforeRunUsd: daySpent };
    } catch (error) {
      return { ...caught(node, error, ranAsStep), daySpentBeforeRunUsd: daySpent };
    }
  };
}

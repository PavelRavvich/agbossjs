import { AGBossError } from "../core/errors.js";
import { totalCost, type UsageRecord } from "../finops/usage.js";
import type { FlowModel } from "./check-flow.js";
import { componentOf } from "../components/metadata.js";
import { collectFlow, type FlowNodeRef } from "./flow-nodes.js";
import type { FlowStateType } from "./flow-state.js";
import { isWorkingKind } from "./node-kind.js";
import type { WorkflowLimits } from "./settings.js";

/** The boundary key of a limit, as people read it in the workflow file. */
export type LimitKey =
  | "limits.perRun.steps"
  | "limits.perRun.cost"
  | "limits.perDay.cost"
  | `routers.${string}.maxVisits`
  | `agents.${string}.limits.modelCalls`
  | `agents.${string}.limits.toolCalls`;

/** What hit a limit: the key, the limit and the value that crossed it. */
export interface LimitBreach {
  readonly key: LimitKey;
  readonly limit: number;
  readonly actual: number;
}

/**
 * A limit was hit — the run **fails** (never a quiet stop), with its path and its spend. `usage` is
 * spend the run's state does not hold yet (an agent's loop stopped midway), so the ledger still sees it.
 */
export class LimitExceededError extends AGBossError {
  static override readonly code: string = "limit";
  override name = "LimitExceededError";
  readonly key: LimitKey;
  readonly limit: number;
  readonly actual: number;
  readonly path: readonly string[];
  readonly spentUsd: number;
  readonly usage: readonly UsageRecord[];

  constructor(
    breach: LimitBreach,
    path: readonly string[],
    spentUsd: number,
    usage: readonly UsageRecord[] = [],
  ) {
    super(
      `Limit ${breach.key} = ${String(breach.limit)} exceeded (${String(breach.actual)}); ` +
        `path: ${path.join(" → ")}; spent $${spentUsd.toFixed(4)}`,
      { details: { key: breach.key, limit: breach.limit, actual: breach.actual } },
    );
    this.key = breach.key;
    this.limit = breach.limit;
    this.actual = breach.actual;
    this.path = path;
    this.spentUsd = spentUsd;
    this.usage = usage;
  }
}

/** A money limit was hit: the run's budget (`limits.perRun.cost`) or the day's (`limits.perDay.cost`). */
export class BudgetExceededError extends LimitExceededError {
  static override readonly code: string = "limit.budget";
  override name = "BudgetExceededError";
}

const isBudgetKey = (key: LimitKey): boolean =>
  key === "limits.perRun.cost" || key === "limits.perDay.cost";

/** The error for a breach: a `BudgetExceededError` for a money limit, else a `LimitExceededError`. */
export function limitError(
  breach: LimitBreach,
  path: readonly string[],
  spentUsd: number,
  usage: readonly UsageRecord[] = [],
): LimitExceededError {
  return isBudgetKey(breach.key)
    ? new BudgetExceededError(breach, path, spentUsd, usage)
    : new LimitExceededError(breach, path, spentUsd, usage);
}

/** The account's day is spent (`limits.perDay.cost`): eval and replay stop there. */
export const isDayCapReached = (error: unknown): boolean =>
  error instanceof LimitExceededError && error.key === "limits.perDay.cost";

/** Limits with defaults applied. */
export interface ResolvedLimits {
  readonly steps: number;
  readonly runCostUsd?: number;
  readonly dayCostUsd?: number;
}

/** Steps per run by default: (agents + routers, nested workflows' included) × 3. */
export const STEPS_PER_WORKING_NODE = 3;

/** Agents and routers of the nodes, those of nested workflows included (not the workflow nodes). */
function workingNodesOf(nodes: Iterable<FlowNodeRef>): number {
  let working = 0;
  for (const ref of nodes) {
    const component = ref.kind === "workflow" ? componentOf(ref.use) : undefined;
    if (component?.kind === "workflow") {
      working += workingNodesOf(collectFlow(component.meta.flow).nodes.values());
    } else if (isWorkingKind(ref.kind)) working += 1;
  }
  return working;
}

export function resolveLimits(limits: WorkflowLimits, model: FlowModel): ResolvedLimits {
  const working = workingNodesOf(model.nodes.values());
  const runCost = limits.perRun?.cost;
  const dayCost = limits.perDay?.cost;
  return {
    steps: limits.perRun?.steps ?? working * STEPS_PER_WORKING_NODE,
    ...(runCost === undefined ? {} : { runCostUsd: runCost }),
    ...(dayCost === undefined ? {} : { dayCostUsd: dayCost }),
  };
}

/** What is checked before a working node runs. */
export interface VisitCheck {
  readonly node: FlowNodeRef;
  readonly limits: ResolvedLimits;
  readonly maxVisits?: number;
  readonly daySpentBeforeRunUsd: number;
}

function breachOf(state: FlowStateType, check: VisitCheck): LimitBreach | undefined {
  const { limits, node } = check;
  const steps = state.steps + 1;
  if (steps > limits.steps)
    return { key: "limits.perRun.steps", limit: limits.steps, actual: steps };
  const visits = (state.visits[node.key] ?? 0) + 1;
  if (check.maxVisits !== undefined && visits > check.maxVisits) {
    return { key: `routers.${node.name}.maxVisits`, limit: check.maxVisits, actual: visits };
  }
  const spent = totalCost(state.usage);
  if (limits.runCostUsd !== undefined && spent >= limits.runCostUsd) {
    return { key: "limits.perRun.cost", limit: limits.runCostUsd, actual: spent };
  }
  const today = check.daySpentBeforeRunUsd + spent;
  if (limits.dayCostUsd !== undefined && today >= limits.dayCostUsd) {
    return { key: "limits.perDay.cost", limit: limits.dayCostUsd, actual: today };
  }
  return undefined;
}

/** Throws `LimitExceededError` (`BudgetExceededError` for money) when visiting this working node would cross a limit. */
export function checkVisit(state: FlowStateType, check: VisitCheck): void {
  const breach = breachOf(state, check);
  if (breach === undefined) return;
  throw limitError(breach, [...state.path, check.node.key], totalCost(state.usage));
}

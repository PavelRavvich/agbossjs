import { AGBossError, type ErrorDetails } from "../core/errors.js";
import type { UsageRecord } from "../finops/usage.js";

/** The boundary key of a limit, as people read it in the workflow file. */
export type LimitKey =
  | "maxSteps"
  | "limits.perRun.cost"
  | "limits.perDay.cost"
  | `${string}.maxVisits`
  | `agents.${string}.limits.modelCalls`
  | `agents.${string}.limits.toolCalls`;

/** What hit a limit: the key, the limit and the value that crossed it. */
export interface LimitBreach {
  readonly key: LimitKey;
  readonly limit: number;
  readonly actual: number;
}

/** A subclass's own sentence and facts (`VisitsLimitExceededError`). */
export interface LimitErrorText {
  readonly message: string;
  readonly details: ErrorDetails;
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
    text?: LimitErrorText,
  ) {
    super(
      text?.message ??
        `Limit ${breach.key} = ${String(breach.limit)} exceeded (${String(breach.actual)}); ` +
          `path: ${path.join(" → ")}; spent $${spentUsd.toFixed(4)}`,
      {
        details: { key: breach.key, limit: breach.limit, actual: breach.actual, ...text?.details },
      },
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

/** Steps per execution by default: (agents + routers) × 3 (#261). */
export const STEPS_PER_WORKING_NODE = 3;

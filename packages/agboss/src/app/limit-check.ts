import { AGBossError } from "../core/errors.js";
import type { WorkflowLimits } from "../graph/settings.js";

/**
 * A workflow with a daily cost limit and no per-run one (#202): each run reserves its run cap of
 * the day before its first call, so without one a single run would hold the whole day.
 */
export class PerRunLimitRequiredError extends AGBossError {
  static override readonly code: string = "limits.per-run-required";
  override name = "PerRunLimitRequiredError";
}

/** Fails when `perDay.cost` is set without `perRun.cost` — at start, before any model call. */
export function checkRunLimits(workflow: string, limits: WorkflowLimits): void {
  if (limits.perDay?.cost === undefined || limits.perRun?.cost !== undefined) return;
  throw new PerRunLimitRequiredError(
    `[limits.per-run-required] workflow "${workflow}" sets limits.perDay.cost but no ` +
      `limits.perRun.cost — add perRun: { cost } to its .limits(…): each run reserves that much ` +
      `of the day before its first call`,
    { details: { workflow } },
  );
}

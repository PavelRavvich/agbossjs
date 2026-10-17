import type { UsageRecord } from "../../finops/usage.js";
import { PaidStepError } from "../../graph/errors.js";

/** Why a router could not decide: its model call failed, or it chose something that is not a route. */
export type RouterFailureCode = "router.failed" | "router.unknown-route";

/** A router could not decide — the execution fails (no guessing), unless an `.onError` takes it. */
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

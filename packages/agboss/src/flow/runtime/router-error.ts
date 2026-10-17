import type { UsageRecord } from "../../finops/usage.js";
import type { RouteOutcome } from "../../routers/index.js";
import { PaidStepError } from "../../graph/errors.js";
import type { ComponentRecord } from "./records.js";

/**
 * A router's two failures (#280 S19), mirroring `AgentFailedError` / `AgentAnswerInvalidError`:
 * it could not decide (`RouterFailedError`, the original error as its `cause`), or what it decided is
 * not allowed (`RouterDecisionError`). Both name the router's step and are caught by `.onError` right
 * after the router; matching goes through the cause chain, so the domain error inside is caught too.
 */

/** The visit of a router an error belongs to (its step). */
export interface RouterVisit {
  /** The router's node id (its `name`). */
  readonly nodeId: string;
  /** The pass through the router in the execution, from 1. */
  readonly visitNumber: number;
}

const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** A router could not decide: `route()` threw, or its model call failed (`cause` = the original). */
export class RouterFailedError extends PaidStepError {
  static override readonly code: string = "step.router";
  override name = "RouterFailedError";
  /** The router (no class: the error is kept on a plain record). */
  readonly component: ComponentRecord;
  readonly nodeId: string;
  readonly visitNumber: number;

  constructor(
    step: RouterVisit,
    cause: unknown,
    usage: readonly UsageRecord[] = [],
    message = `Router "${step.nodeId}" failed: ${describe(cause)}`,
  ) {
    super(message, usage, cause, {
      component: { name: step.nodeId },
      nodeId: step.nodeId,
      visitNumber: step.visitNumber,
    });
    this.component = { name: step.nodeId };
    this.nodeId = step.nodeId;
    this.visitNumber = step.visitNumber;
  }
}

/**
 * A router's answer is not allowed: a target outside its routes, a list after `.chooseOne(…)`, an
 * empty list without an `Always` route, an unknown or unreadable answer from its model. Never retried.
 */
export class RouterDecisionError extends RouterFailedError {
  static override readonly code: string = "step.router.invalid-decision";
  override name = "RouterDecisionError";
  /** What was wrong with the answer. */
  readonly reason: string;

  constructor(step: RouterVisit, reason: string, usage: readonly UsageRecord[] = []) {
    super(step, undefined, usage, `Router "${step.nodeId}" decided wrongly: ${reason}`);
    this.reason = reason;
  }
}

/** A model router's failed outcome as its step's error: the call failed, or the answer is not allowed. */
export function routerFailureOf(
  step: RouterVisit,
  outcome: Extract<RouteOutcome, { kind: "failed" }>,
): RouterFailedError {
  const usage = outcome.usage === undefined ? [] : [outcome.usage];
  return outcome.cause === undefined
    ? new RouterDecisionError(step, outcome.reason, usage)
    : new RouterFailedError(step, outcome.cause, usage);
}

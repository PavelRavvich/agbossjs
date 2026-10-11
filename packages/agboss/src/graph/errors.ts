import { AGBossError, type ErrorDetails } from "../core/errors.js";
import type { UsageRecord } from "../finops/usage.js";

const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** A step of the run failed after spending money; carries that spend so the ledger still sees it. */
export class PaidStepError extends AGBossError {
  static override readonly code: string = "step";
  override name = "PaidStepError";
  readonly usage: readonly UsageRecord[];

  constructor(
    message: string,
    usage: readonly UsageRecord[],
    cause: unknown,
    details?: ErrorDetails,
  ) {
    super(message, { cause, ...(details === undefined ? {} : { details }) });
    this.usage = usage;
  }
}

/** An agent's loop failed. */
export class AgentFailedError extends PaidStepError {
  static override readonly code: string = "step.agent";
  override name = "AgentFailedError";
  readonly agent: string;

  constructor(
    agent: string,
    usage: readonly UsageRecord[],
    cause: unknown,
    details: ErrorDetails = {},
  ) {
    super(`Agent "${agent}" failed: ${describe(cause)}`, usage, cause, { agent, ...details });
    this.agent = agent;
  }
}

/** One judge's reason for rejecting an agent's reply. */
export interface JudgeFeedback {
  readonly judge: string;
  readonly feedback: string;
}

/** An agent's reply still failed its judges after `maxRetries` retries. */
export class QualityGateError extends AgentFailedError {
  static override readonly code: string = "step.agent.quality-gate";
  override name = "QualityGateError";
  /** What the judges said about the last reply. */
  readonly feedback: readonly JudgeFeedback[];
  readonly retries: number;

  constructor(
    agent: string,
    usage: readonly UsageRecord[],
    feedback: readonly JudgeFeedback[],
    retries: number,
  ) {
    const said = feedback.map((f) => `[${f.judge}] ${f.feedback}`).join("; ");
    const reason = `quality gate not passed after ${String(retries)} retries: ${said}`;
    super(agent, usage, reason, { feedback: feedback.map((f) => ({ ...f })), retries });
    this.feedback = feedback;
    this.retries = retries;
  }
}

/** A guard could not routeTo — the run fails closed instead of letting content through. */
export class GuardFailedError extends PaidStepError {
  static override readonly code: string = "step.guard";
  override name = "GuardFailedError";
  readonly guard: string;

  constructor(guard: string, usage: readonly UsageRecord[], reason: string) {
    super(`Guard "${guard}" failed: ${reason}`, usage, reason, { guard });
    this.guard = guard;
  }
}

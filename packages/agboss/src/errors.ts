/**
 * The errors a run can fail with — every one a `AGBossError` with a stable `code`, so a flow
 * can `catchError(<class>)` it (also after a resume from a checkpoint) and a caller can tell them
 * apart. `limit` ⊃ `limit.budget`; `step` ⊃ `step.agent`, `step.guard`, `step.router`.
 */
export {
  AGBossError,
  WorkflowCancelledError,
  type ErrorDetails,
  type AGBossErrorOptions,
} from "./core/errors.js";
export { errorRecordOf, type ErrorRecord } from "./core/error-record.js";
export { BudgetExceededError, LimitExceededError, type LimitKey } from "./graph/limits.js";
export {
  AgentFailedError,
  GuardFailedError,
  PaidStepError,
  QualityGateError,
  type JudgeFeedback,
} from "./graph/errors.js";
export { RouterDecisionError, type RouterFailureCode } from "./graph/nodes/flow-router.js";
export { ModelCallError, type ModelCallErrorCode } from "./models/circuit-breaker.js";
export { ToolTimeoutError } from "./tools/index.js";
export { DtoValidationError } from "./dto/errors.js";
export { NotPausedError } from "./run/resume-agent.js";
export { ThreadOwnerError, UnknownThreadError } from "./run/thread.js";
export {
  DecisionError,
  DecisionRequestError,
  DecisionResponseError,
  ModelKindError,
  type ModelKind,
} from "./llm/decision-errors.js";
export { PerRunLimitRequiredError } from "./app/limit-check.js";

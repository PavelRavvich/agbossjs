import type { StepRecord, WorkflowRecord } from "../context/execution-context.js";
import type { OutdatedValueReference, ScopeValueReference } from "../runtime/records.js";

/**
 * The observer event of an outdating (#271 S12): one per cascade, only when something was outdated.
 * Plain data, never a DTO value — the values themselves are in `result.record` (`outdatedValues`).
 */

/** What every execution event carries (#261): which execution, thread and workflow. */
export interface ExecutionEvent {
  /** Unique per execution; the same after a resume (`result.runId`). */
  readonly executionId: string;
  /** The parent execution; `undefined` at the root (child executions come with #263). */
  readonly parentExecutionId: string | undefined;
  /** The root execution's id; the execution's own at the root. */
  readonly rootExecutionId: string;
  readonly threadId: string;
  readonly workflow: WorkflowRecord;
}

/**
 * A write outdated values (`onValuesOutdated`): `step` wrote `trigger`, which outdated `outdated` —
 * the whole cascade, the same set (and order) as it adds to `result.record.outdatedValues`.
 */
export interface ValuesOutdatedEvent extends ExecutionEvent {
  /** The step that wrote the new value. */
  readonly step: StepRecord;
  /** The new value: the root trigger of the cascade (`byValueId` of every outdated value). */
  readonly trigger: ScopeValueReference;
  /** Never empty: the replaced value, then what was built from it, each with its reason. */
  readonly outdated: readonly OutdatedValueReference[];
}

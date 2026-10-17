import type { RunnableConfig } from "@langchain/core/runnables";
import { extractRunContext } from "../../core/run-context.js";
import type { WorkflowDescriptor } from "../context/execution-context.js";
import type { FrameSpec } from "../context/frame.js";
import { idempotencyKeyOf } from "../context/idempotency.js";
import type { RuntimeNode } from "./graph-model.js";
import type { ExecutionStateType } from "./state.js";

/** The workflow an execution runs, as the runtime knows it before the execution starts. */
export type WorkflowIdentity = Omit<WorkflowDescriptor, "startedVersion">;

/** The version the execution started on: kept in state from its first node, so a resume keeps it. */
export const startedVersionOf = (state: ExecutionStateType, workflow: WorkflowIdentity): string =>
  state.startedVersion === "" ? workflow.version : state.startedVersion;

/**
 * The frame of one visit of `node` (#280): the execution's flat fields from its run, the step —
 * its component, node id, visit number (the one `maxVisits` counts) and its idempotency key. A
 * resume runs the visit again with the same state, so the same number and key.
 */
export function stepFrameOf(
  node: RuntimeNode,
  state: ExecutionStateType,
  config: RunnableConfig | undefined,
  workflow: WorkflowIdentity,
): FrameSpec {
  const { run } = extractRunContext(config, state.runId);
  const executionId: string = run.runId;
  const visitNumber = (state.visits[node.id] ?? 0) + 1;
  const step = {
    component: Object.freeze({ type: node.component, name: node.id }),
    nodeId: node.id,
    visitNumber,
    idempotencyKey: idempotencyKeyOf({ executionId, nodeId: node.id, visitNumber }),
    callId: undefined,
    itemIndex: undefined,
    copyNumber: 1,
  };
  return {
    execution: Object.freeze({
      executionId,
      threadId: run.threadId,
      ownerId: run.owner,
      signal: run.signal,
      workflow: Object.freeze({ ...workflow, startedVersion: startedVersionOf(state, workflow) }),
    }),
    step: Object.freeze(step),
  };
}

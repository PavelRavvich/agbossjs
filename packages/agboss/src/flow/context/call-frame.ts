import type { Class } from "../../components/injection.js";
import type { WorkflowDescriptor } from "./execution-context.js";
import type { FrameSpec } from "./frame.js";
import { idempotencyKeyOf } from "./idempotency.js";

/** A tool called on its own, not by an agent: over MCP, or `app.tool(T).invoke(…)` in a test. */
export interface StandaloneCall {
  readonly workflow: Omit<WorkflowDescriptor, "startedVersion">;
  /** The tool's class and its `name` (the step's node id). */
  readonly type: Class;
  readonly name: string;
  readonly executionId: string;
  readonly callId: string;
  readonly signal: AbortSignal;
}

/**
 * The frame of a tool called on its own (#280): an execution of one step of its own, the call's
 * id as its `step.callId`, so an injected `ExecutionContext` reads as in an agent's tool call.
 */
export function standaloneCallFrameOf(call: StandaloneCall): FrameSpec {
  const { workflow, type, name, executionId, callId } = call;
  const visitNumber = 1;
  return {
    execution: Object.freeze({
      executionId,
      threadId: executionId,
      ownerId: undefined,
      signal: call.signal,
      workflow: Object.freeze({ ...workflow, startedVersion: workflow.version }),
    }),
    step: Object.freeze({
      component: Object.freeze({ type, name }),
      nodeId: name,
      visitNumber,
      idempotencyKey: idempotencyKeyOf({ executionId, nodeId: name, visitNumber, callId }),
      callId,
      itemIndex: undefined,
      copyNumber: 1,
    }),
  };
}

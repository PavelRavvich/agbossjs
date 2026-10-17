import { randomUUID } from "node:crypto";
import { appWorkflowOf } from "../app/app-workflow.js";
import type { App } from "../app/types.js";
import type { Class } from "../components/injection.js";
import { runInFrame, type FrameSpec } from "../flow/context/frame.js";
import { idempotencyKeyOf } from "../flow/context/idempotency.js";
import type { McpCall } from "./mcp-service-helpers.js";

/** An exported tool as one call over MCP sees it: its app, its class and its `name`. */
export interface ExportedToolCall {
  readonly app: App;
  readonly type: Class;
  readonly name: string;
}

/**
 * The frame of a tool called over MCP (#280): an execution of one step of its own, the tool's
 * call id the client's `_meta.callId` (else a new one). The execution id follows the call id, so a
 * client repeating a call with the same `callId` gets the same `step.idempotencyKey`.
 */
function frameOf({ app, type, name }: ExportedToolCall, call: McpCall): FrameSpec | undefined {
  const workflow = appWorkflowOf(app);
  if (workflow === undefined) return undefined;
  const callId = call.callId ?? `mcp_${name}_${randomUUID()}`;
  const executionId = `mcp_${callId}`;
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

/** Runs one MCP call of an exported tool in its own frame (what `deps: [ExecutionContext]` reads). */
export function inMcpCallFrame<TResult>(
  tool: ExportedToolCall,
  call: McpCall,
  work: () => Promise<TResult>,
): Promise<TResult> {
  const frame = frameOf(tool, call);
  return frame === undefined ? work() : runInFrame(frame, work);
}

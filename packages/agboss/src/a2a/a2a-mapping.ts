import type { ExecutionOutput } from "../app/types.js";
import { WorkflowCancelledError } from "../core/errors.js";
import { LimitExceededError } from "../graph/limits.js";
import type { RunStatus, RunStreamEvent } from "../run/types.js";
import type { A2AEvent, A2AExecutionResponse, A2AStatus } from "./types.js";

const unreachable = (value: never): never => {
  throw new Error(`Unhandled value: ${JSON.stringify(value)}`);
};

/** The A2A status of a run the app returned (every `RunStatus` mapped; a new one fails to compile). */
export function statusOf(status: RunStatus): A2AStatus {
  switch (status) {
    case "answered":
      return "answered";
    case "guarded":
      return "guarded";
    case "paused":
      return "paused";
    default:
      return unreachable(status);
  }
}

/** The A2A status of a run that threw: cancelled (its signal, `app.cancel`), a limit → limited, else failed. */
export function failureStatusOf(error: unknown, signal: AbortSignal | undefined): A2AStatus {
  if (signal?.aborted === true || error instanceof WorkflowCancelledError) return "cancelled";
  if (error instanceof LimitExceededError) return "limited";
  return "failed";
}

/** The response for a run the app returned: its thread, status, reply and finish output. */
export function responseOf(output: ExecutionOutput): A2AExecutionResponse {
  return {
    thread: output.thread,
    status: statusOf(output.status),
    reply: output.replyWith,
    ...(output.finish === undefined ? {} : { finish: output.finish, output: output.output }),
  };
}

/** The response for a run that threw. */
export function failureResponseOf(
  error: unknown,
  signal: AbortSignal | undefined,
  thread: string | undefined,
): A2AExecutionResponse {
  return {
    ...(thread === undefined ? {} : { thread }),
    status: failureStatusOf(error, signal),
    reply: "",
    error: error instanceof Error ? error.message : String(error),
  };
}

/** A stream event of the run as an A2A progress event. */
export function eventOf(event: RunStreamEvent): A2AEvent {
  switch (event.kind) {
    case "textDelta":
      return { type: "progress", payload: { step: "text", content: event.delta } };
    case "toolCall":
      return { type: "progress", payload: { step: "tool", content: event.tool } };
    default:
      return unreachable(event);
  }
}

import type { BaseCheckpointSaver } from "@langchain/langgraph";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { AnyTool } from "../tools/index.js";

/**
 * The seam a project plugs in to pause a run for an approval (e.g. before a write tool).
 * Off by default: without it the core never pauses. The core ships the rules; projects bring a
 * durable checkpointer and the channel that collects the approver's decision.
 */
export interface PauseSeam {
  readonly checkpointer: BaseCheckpointSaver;
}

/** Default policy: tools that change the outside world need an approval. */

/** A tool call: which agent asked for which tool with which arguments. */
export interface AgentToolCall {
  readonly agent: string;
  readonly tool: string;
  readonly args: unknown;
}

/** A tool call waiting for an approval — one call per pause. */
export type PendingPauseKind = "approval" | "interactive";

export interface PendingPause extends AgentToolCall {
  readonly kind: PendingPauseKind;
  readonly payload?: unknown;
  /** The call's id (the idempotency key its tool gets). */
  readonly callId: string;
}

/** A decided call: approved (with the tool's result) or rejected (with the decision's reason). */
export interface ApprovalRecord extends AgentToolCall {
  readonly approved: boolean;
  /** Who or what decided (`ToolCallApprovalDecision.by`). */
  readonly by: string;
  readonly feedback?: string;
  readonly overrideArguments?: Record<string, unknown>;
  readonly result?: string;
}

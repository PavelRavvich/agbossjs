import type { FlowStateUpdate } from "./flow-state.js";
import type { MessageContent } from "@langchain/core/messages";

/** Represents the output of a single executed branch. */
export interface ForkOutput<T = string> {
  /** Agent text or DTO from a WorkflowAction */
  readonly data: T;
  /** Executed node name */
  readonly name: string;
  /** Status of the execution, mostly to notify about skipped branches */
  readonly status?: "completed" | "skipped";
}

/** A mapped type utility that wraps the keys of the expected object. */
export type ForkOutputs<T> = { [K in keyof T]: ForkOutput<T[K]> };

/** The unified response object returned by the join handler. */
export interface JoinOutput {
  /** New messages added to the common thread. `agent` is optional (defaults to current node). */
  readonly contributions?: { agent?: string; content: MessageContent }[];
  /** Custom business data passed to state.payload */
  readonly payload?: Record<string, unknown>;
  /** Direct diff applied to LangGraph state */
  readonly update?: FlowStateUpdate;
}

/** The interface implemented by the consumer node. */
export interface JoinHandler<T extends Record<string, ForkOutput<unknown>>> {
  onJoin(outputs: T): JoinOutput | Promise<JoinOutput>;
}

/** Defines the expected output payload shape for an agent. */
export interface AgentOutput<T> {
  // Marker property to retain type info (could be implemented or not, it's just for TS)
  __payloadType?: T;
}

/** Utility type for join handlers to cleanly expect an array of ForkOutputs. */
export type JoinArray<T> = ForkOutput<T>[];

import type { AIMessage, BaseMessage } from "@langchain/core/messages";
import { Annotation } from "@langchain/langgraph";
import type { UsageRecord } from "../../finops/usage.js";
import { FlowState } from "../flow-state.js";

const append = <TItem>(left: TItem[], right: TItem[]): TItem[] => left.concat(right);
const replace = <TValue>(_previous: TValue, next: TValue): TValue => next;
const add = (left: number, right: number): number => left + right;
const merge = <TValue>(
  left: Readonly<Record<string, TValue>>,
  right: Readonly<Record<string, TValue>>,
): Record<string, TValue> => ({ ...left, ...right });

/** A finished tool call, stored under its call id: after a resume or a restart it is never run again. */
export interface StoredToolCall {
  readonly callId: string;
  readonly tool: string;
  /** What the model reads back: the tool's result, or `Tool error: …`. */
  readonly content: string;
}

/** An approver's decision on one call, before it ran. */
export interface CallDecision {
  readonly approved: boolean;
  readonly by: string;
  readonly feedback?: string;
  readonly overrideArguments?: Record<string, unknown>;
}

/** How long the appended lists were when the flow handed the agent its work. */
export interface HandedOver {
  readonly contributions: number;
  readonly usage: number;
  readonly approvals: number;
}

const NOTHING_HANDED_OVER: HandedOver = { contributions: 0, usage: 0, approvals: 0 };

/**
 * The state of one agent's loop (its subgraph): the flow's agent state it was handed, plus the
 * conversation with the model, the move under way, finished calls and decisions by call id, and the
 * counters its limits check. Checkpointed node by node — each tool call is its own task.
 */
export const AgentLoopState = Annotation.Root({
  ...FlowState.spec,
  /** The flow nodes visited up to and including this agent (limit errors name it). */
  flowPath: Annotation<string[]>({ reducer: replace, default: () => [] }),
  /** Where this loop's additions start in the lists it was handed. */
  from: Annotation<HandedOver>({ reducer: replace, default: () => NOTHING_HANDED_OVER }),
  /** The conversation the model sees (the system prompt is added per call). */
  messages: Annotation<BaseMessage[]>({ reducer: append, default: () => [] }),
  /** The model's last move while its tool calls are judged, approved and run. */
  move: Annotation<AIMessage | null>({ reducer: replace, default: () => null }),
  results: Annotation<Record<string, StoredToolCall>>({ reducer: merge, default: () => ({}) }),
  decisions: Annotation<Record<string, CallDecision>>({ reducer: merge, default: () => ({}) }),
  modelCalls: Annotation<number>({ reducer: add, default: () => 0 }),
  toolCalls: Annotation<number>({ reducer: add, default: () => 0 }),
  /** The agent's replyWith; null while it is still working. */
  reply: Annotation<string | null>({ reducer: replace, default: () => null }),
  retries: Annotation<number>({ reducer: add, default: () => 0 }),
});

export type AgentLoopStateType = typeof AgentLoopState.State;
export type AgentLoopUpdate = typeof AgentLoopState.Update;

/** What this loop spent so far (not in the flow's state until the agent answers). */
export const loopUsage = (state: AgentLoopStateType): UsageRecord[] =>
  state.usage.slice(state.from.usage);

/** One tool call to run — the payload of its own task (`Send`). */
export interface ToolTask {
  readonly callId: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly runId: string;
}

export const LOOP_NODE = {
  input: "input",
  model: "model",
  boundary: "boundary",
  approval: "approval",
  tool: "tool",
  collect: "collect",
  replyWith: "agent-replyWith",
  judge: "judge",
} as const;

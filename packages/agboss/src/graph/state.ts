import { Annotation } from "@langchain/langgraph";
import type { UsageRecord } from "../finops/usage.js";
import type { ApprovalRecord } from "../pause/index.js";
import type { FinishOutput } from "../app/types.js";
import type { Contribution, HistoryTurn } from "./contributions.js";

const append = <TItem>(left: TItem[], right: TItem[]): TItem[] => left.concat(right);

const mergeRecords = <TRecord extends Record<string, unknown>>(
  left: TRecord,
  right: TRecord,
): TRecord => ({
  ...left,
  ...right,
});

/** Single source of truth for the graph state. Nodes return only the keys they own. */
export const AgentState = Annotation.Root({
  task: Annotation<string>(),
  /** Previous Terns of the thread, oldest first (loaded once per run). */
  history: Annotation<HistoryTurn[]>({ reducer: (_previous, next) => next, default: () => [] }),
  /**
   * The validated input of the workflow start the run began at (`ctx.run.input`, `{{input.<field>}}`);
   * checkpointed, so a resume reads it back.
   */
  startInput: Annotation<Record<string, unknown>>({
    reducer: (_previous, next) => next,
    default: () => ({}),
  }),
  /** Id of this run (tools and logs). */
  runId: Annotation<string>({ reducer: (_previous, next) => next, default: () => "" }),
  /** The node the last router chose (an agent's name while it runs). */
  next: Annotation<string>({
    reducer: (p, n) => {
      if (!p) return n;
      if (p === "__end__") return n;
      if (n === "__end__") return p;
      return n;
    },
    default: () => "",
  }),
  /** Why the last router chose what it chose ("" before any router decided). */
  routeReason: Annotation<string>({ reducer: (_previous, next) => next, default: () => "" }),
  contributions: Annotation<Contribution[]>({ reducer: append, default: () => [] }),
  /** FinOps: spend allowed for this run (run cap ∩ what is left of the workflow's daily cap). */
  budgetUsd: Annotation<number>({
    reducer: (_previous, next) => next,
    default: () => Number.POSITIVE_INFINITY,
  }),
  /** FinOps: every LLM call appends one record. */
  usage: Annotation<UsageRecord[]>({ reducer: append, default: () => [] }),
  replyWith: Annotation<string>(),
  finishes: Annotation<Record<string, FinishOutput>>({
    reducer: mergeRecords,
    default: () => ({}),
  }),
  /** Conversation memory notes (compaction), oldest first; loaded once per run. */
  summaries: Annotation<string[]>({ reducer: (_previous, next) => next, default: () => [] }),
  /** The approval decisions on tool calls in this run. */
  approvals: Annotation<ApprovalRecord[]>({ reducer: append, default: () => [] }),
  /** Name of the guard that stopped the run, "" if none. */
  guarded: Annotation<string>({ reducer: (_previous, next) => next, default: () => "" }),
  /** Custom developer KV data aggregated across workflow. */
  payload: Annotation<Record<string, unknown>>({ reducer: mergeRecords, default: () => ({}) }),
  /** System cursor for batchParallel loop elements. */
  batchItem: Annotation<unknown>({ reducer: (p, n) => n }),
  /** The index of `batchItem` among the step's items (its batch's index for `batchSize` > 1). */
  batchIndex: Annotation<number | undefined>({ reducer: (p, n) => n }),
  /** Per batch target: the items still queued and the batches of the current round. */
  _batchCursor: Annotation<
    Record<string, { queue: unknown[]; activeBatch?: unknown[][]; offset?: number } | undefined>
  >({
    reducer: mergeRecords,
    default: () => ({}),
  }),
  /** System flag indicating that the run was cancelled externally. */
  cancelRequested: Annotation<boolean>({
    reducer: (_previous, next) => next,
    default: () => false,
  }),
});

export type AgentStateType = typeof AgentState.State;

/** Strongly typed agent state wrapper to strictly define the expected payload. */
export type AgentState<Payload = Record<string, unknown>> = Omit<
  AgentStateType,
  "payload" | "batchItem"
> & {
  payload: Payload;
  batchItem?: unknown;
};

/** Strongly typed state for an agent executing inside a batchParallel loop. */
export type BatchAgentState<Payload = Record<string, unknown>, Item = unknown> = Omit<
  AgentStateType,
  "payload" | "batchItem"
> & {
  payload: Payload;
  batchItem: Item;
};

export type AgentStateUpdate = typeof AgentState.Update;

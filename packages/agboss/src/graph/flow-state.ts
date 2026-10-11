import { Annotation } from "@langchain/langgraph";
import { AgentState } from "./state.js";
import type { ForkOutput } from "./fork-join.js";
import type { ErrorRecord } from "../core/error-record.js";

const replace = <TValue>(_previous: TValue, next: TValue): TValue => next;

const addCounts = (
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
): Record<string, number> => {
  const sum: Record<string, number> = { ...left };
  for (const [name, count] of Object.entries(right)) sum[name] = (sum[name] ?? 0) + count;
  return sum;
};

const mergeForks = (
  left: Readonly<Record<string, ForkOutput<unknown>>>,
  right: Readonly<Record<string, ForkOutput<unknown>>>,
): Record<string, ForkOutput<unknown>> => ({
  ...left,
  ...right,
});

/**
 * The state of a flow graph: the agent state the existing nodes work on, plus what the flow engine
 * keeps — the workflow start the run begins at, the previous working node (for `Self`), visits per node,
 * steps per run, the path, and the day's spend when the run started (for `limits.perDay.cost`).
 */
const mergeOptional = (left: string[], right: string[]): string[] =>
  Array.from(new Set([...left, ...right]));

export const FlowState = Annotation.Root({
  ...AgentState.spec,
  optionalBranches: Annotation<string[]>({ reducer: mergeOptional, default: () => [] }),
  /** The workflow start this run begins at (name); may be empty when the flow has one start. */
  start: Annotation<string>({ reducer: replace, default: () => "" }),
  /** The last agent that ran ("" before any) — where `Self` leads. */
  previousAgent: Annotation<string>({ reducer: replace, default: () => "" }),
  /** Visits per node (key) in this run. */
  visits: Annotation<Record<string, number>>({ reducer: addCounts, default: () => ({}) }),
  /** Visits of agents and routers in this run (`limits.perRun.steps`). */
  steps: Annotation<number>({ reducer: (left, right) => left + right, default: () => 0 }),
  /** Every node visited in this run (keys), in order. */
  path: Annotation<string[]>({ reducer: (left, right) => left.concat(right), default: () => [] }),
  /** The workflow's spend today before this run (read once, at the first working node). */
  daySpentBeforeRunUsd: Annotation<number | null>({ reducer: replace, default: () => null }),
  /** Accumulated outputs from fork branches. */
  forks: Annotation<Record<string, ForkOutput<unknown>>>({
    reducer: mergeForks,
    default: () => ({}),
  }),
  /**
   * The error a `catchError` caught at the last node, as a plain record (it survives a serialising
   * checkpointer); cleared by the next node that runs.
   */
  lastError: Annotation<ErrorRecord | null>({ reducer: replace, default: () => null }),
});

export type FlowStateType = typeof FlowState.State;
export type FlowStateUpdate = typeof FlowState.Update;

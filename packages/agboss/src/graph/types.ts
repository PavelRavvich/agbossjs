import type { RunnableConfig } from "@langchain/core/runnables";
/** A pure LangGraph node: reads the full state, returns only the keys it owns. */
export type SyncNode<TState extends object, TUpdate extends object> = (state: TState) => TUpdate;

/** An effectful LangGraph node (LLM, tools, I/O). */
export type AsyncNode<TState extends object, TUpdate extends object> = (
  state: TState,
  /** LangGraph's run config (callbacks for tracing, signal). */
  config?: RunnableConfig,
) => Promise<TUpdate>;

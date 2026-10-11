import type { FinishOutput } from "../app/types.js";
import type { SpendLedger } from "../finops/ledger.js";
import type { CostReport } from "../finops/usage.js";
import type { GraphDeps } from "../graph/deps.js";
import type { Compacted } from "./compaction.js";
import type { PendingPause } from "../pause/index.js";
import type { TernStore } from "../terns/index.js";
import type { RunTracing } from "../tracing/index.js";

/** Graph dependencies plus the daily spend ledger and the Tern store. */
export interface RunDeps<TName extends string> extends GraphDeps<TName> {
  readonly ledger: SpendLedger;
  readonly terns: TernStore;
  /** Compaction prompt (workflow override); default in src/prompts/compaction.ts. */
  readonly compactionPrompt?: string | undefined;
  /** Optional tracing (e.g. local Langfuse); runs are identical without it. */
  readonly tracing?: RunTracing | undefined;
  /** A new run id; random by default, deterministic in tests. */
  readonly newRunId?: () => string;
}

/** Which ledger account pays for a run and its daily cap. Default: the workflow itself. */
export interface SpendAccount {
  readonly key: string;
  readonly dailyCap: number;
}

/** A stream event for real-time UI/CLI updates. */
export type RunStreamEvent =
  | { readonly kind: "textDelta"; readonly delta: string }
  | { readonly kind: "toolCall"; readonly tool: string; readonly args?: unknown };

export interface RunOptions {
  /** The run's id, made once by the app (its observer events use it too); default: a new one. */
  readonly runId?: string;
  /** Id of the Tern this run replays (eval). */
  readonly replayOf?: string;
  readonly account?: SpendAccount;
  /** Aborts the run (graph and in-flight model calls), e.g. when the user presses Esc. */
  readonly signal?: AbortSignal | undefined;
  /** Callback to receive token streaming and tool calls in real time. */
  readonly onStream?: (event: RunStreamEvent) => void;
  readonly executionContext?: unknown;
  /** The run's metadata, read by tools and actions as `ctx.run.metadata`. */
  readonly metadata?: Readonly<Record<string, string>> | undefined;
  /** The thread's owner, read by tools and actions as `ctx.run.owner` (checked by the app). */
  readonly owner?: string | undefined;
  /** Extra LangGraph `configurable` keys for the run's nodes (the framework's own keys win). */
  readonly configurable?: Readonly<Record<string, unknown>> | undefined;
}

/** How a run ended for its caller. Failures are thrown, not returned. */
export type RunStatus = "answered" | "guarded" | "paused";

export interface AgentExecutionOutput {
  readonly status: RunStatus;
  readonly replyWith: string;
  /** Agents in the order they ran. */
  readonly route: readonly string[];
  /** Flow node keys in the order the run visited them (a paused run: up to the waiting agent). */
  readonly path: readonly string[];
  /** The workflow finish the run reached (absent when a guard stopped it or it is paused). */
  readonly finish?: string;
  readonly finishes?: Record<string, FinishOutput>;
  readonly stopReason: string;
  readonly budgetUsd: number;
  readonly cost: CostReport;
  readonly threadId: string;
  readonly ternId: string;
  /** Conversation memory: what this turn compacted, when it did. */
  readonly compacted?: Compacted;
  /** The conversation in the tracing UI (session = thread), when tracing is on. */
  readonly traceUrl?: string;
  /** The run's id (observer events, `ctx.run.runId`, its Tern, its checkpoint — a resume keeps it). */
  readonly runId: string;
  /** Present only when `status` is "paused": the tool call waiting for an approval. */
  readonly pending?: PendingPause;
  /** The run's metadata (`RunOptions.metadata`), kept so its resume sees the same `ctx.run.metadata`. */
  readonly metadata?: Readonly<Record<string, string>>;
}

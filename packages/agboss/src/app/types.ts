import type { ContentBlock } from "@langchain/core/messages";
import type { Class } from "../components/injection.js";
import type { WorkflowFinishText } from "../dto/standard/framework.js";
import type { CostReport } from "../finops/usage.js";
import type { FlowNode } from "../graph/flow.js";
import type { StartInputOf, WorkflowStartClass } from "../graph/workflow-start.decorator.js";
import type { PendingPause } from "../pause/index.js";
import type { AgentExecutionOutput, RunStreamEvent } from "../run/types.js";

export interface FinishOutput {
  readonly kind: string;
}

export interface TextFinishOutput extends FinishOutput {
  readonly kind: "text";
  readonly text: string;
}

export interface MultimodalFinishOutput extends FinishOutput {
  readonly kind: "multimodal";
  // Content blocks: mixed text, tool calls, images, etc.
  readonly blocks: readonly ContentBlock[];
}

export interface JsonFinishOutput<T = unknown> extends FinishOutput {
  readonly kind: "json";
  readonly data: T;
}

export interface ImageFinishOutput extends FinishOutput {
  readonly kind: "image";
  readonly mimeType: string;
  readonly data: Uint8Array;
}

export interface AudioFinishOutput extends FinishOutput {
  readonly kind: "audio";
  readonly mimeType: string;
  readonly data: Uint8Array;
}

export interface VideoFinishOutput extends FinishOutput {
  readonly kind: "video";
  readonly mimeType: string;
  readonly data: Uint8Array;
}

export interface BinaryFinishOutput extends FinishOutput {
  readonly kind: "binary";
  readonly mimeType: string;
  readonly data: Uint8Array;
}

/** Per call: the conversation to continue (omit for a new one) and what the run carries. */
export interface ExecutionOptions {
  readonly thread?: string;
  /** Stops the run, like `app.cancel(thread)`. */
  readonly signal?: AbortSignal | undefined;
  /** Token and tool-call events while the run works. */
  readonly onStream?: (event: RunStreamEvent) => void;
  readonly executionContext?: unknown;
  /**
   * Who the thread belongs to (a user, a tenant). A new thread is bound to it; continuing,
   * resuming or cancelling a thread with another owner (or none for an owned thread) throws
   * `ThreadOwnerError` before anything runs. Read by tools and actions as `ctx.run.owner`.
   */
  readonly owner?: string | undefined;
  /** Read by tools and actions as `ctx.run.metadata`; a resume keeps it unless it passes its own. */
  readonly metadata?: Readonly<Record<string, string>>;
  /** Extra LangGraph `configurable` keys for the run's nodes (the framework's own keys win). */
  readonly configurable?: Readonly<Record<string, unknown>>;
}

/** `app.cancel(thread, { owner })`: the caller's owner, checked like `execute`'s. */
export interface CancelOptions {
  readonly owner?: string | undefined;
}

/** What `app.cancel(thread)` did: `cancelled` when the thread had a running or a paused run. */
export interface CancelOutput {
  readonly cancelled: boolean;
}

/**
 * What one run (or resume) of the app ended with. `finish` / `output` when it reached a workflow
 * finish, `pause` when it waits for an approval; `path` = the flow nodes it visited, `spend` = its cost.
 */
export interface ExecutionOutput extends Pick<
  AgentExecutionOutput,
  "status" | "replyWith" | "route" | "stopReason" | "compacted" | "traceUrl"
> {
  readonly thread: string;
  /**
   * The run's id: the same in its observer events, `ctx.run.runId`, its Tern and its trace, and
   * kept by its resumes.
   */
  readonly runId: string;
  /** The name of the workflow finish the run reached. */
  readonly finish?: string;
  readonly output?: WorkflowFinishText;
  readonly finishes?: Record<string, FinishOutput>;
  /** What the run waits for (until #117: the tool call waiting for approval). */
  readonly pause?: PendingPause;
  /** Flow nodes in the order the run visited them: node classes, or named nodes. */
  readonly path: readonly FlowNode[];
  readonly spend: CostReport;
}

/**
 * A workflow, built and started: its container, graph (all assembly errors at once) and
 * `onStart` hooks. `run` starts at a workflow start, `resume` continues a paused thread, `close`
 * runs `onStop` hooks and closes MCP connections.
 */
export interface App {
  readonly name: string;
  readonly version: string;
  /** Startup warnings, e.g. a config changed without a version bump. */
  readonly warnings: readonly string[];
  /** One line per model use: its provider, reasoning and caching (the startup log). */
  readonly models: readonly string[];
  /** The workflow start a plain text goes to (input `WorkflowStartText`), if the flow has one. */
  readonly textStart: WorkflowStartClass | undefined;
  /**
   * Runs the workflow from a `@WorkflowStart` class; `input` is checked against the DTO the start
   * declares (`declare readonly input: ChatIn`), so a missing required field is a compile error.
   */
  execute<S extends WorkflowStartClass>(
    start: S,
    input: StartInputOf<S>,
    options?: ExecutionOptions,
  ): Promise<ExecutionOutput>;
  resume(
    thread: string,
    decision: unknown,
    options?: Omit<ExecutionOptions, "thread">,
  ): Promise<ExecutionOutput>;
  /**
   * Cancels the thread's run: a running one is aborted (`ctx.run.signal`; its `execute` rejects
   * with `WorkflowCancelledError`), a paused one is dropped (its `resume` throws `NotPausedError`).
   */
  cancel(thread: string, options?: CancelOptions): Promise<CancelOutput>;
  close(): Promise<void>;
  /** Resolves a service or component from the app's internal container. */
  resolve<T>(token: Class<T> | symbol | string): T;
  /** Whether the workflow uses a tool of this name (local, MCP or knowledge-base search). */
  hasTool(name: string): boolean;
}

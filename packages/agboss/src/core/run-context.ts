import type { RunnableConfig } from "@langchain/core/runnables";
import type { QuorumManager } from "../concurrency/quorum-manager.js";
import { WorkflowCancelledError } from "./errors.js";

/** The id of one run (one `execute`, kept by its resumes) — not the conversation thread. */
export type RunId = string & { readonly __brand: "RunId" };

/** Marks a string as a run id (the framework's own ids; tests building a context). */
export const runIdOf = (id: string): RunId => id as RunId;

/**
 * What every tool and action knows about the run it is part of, as `ctx.run`: built once per
 * `execute` / `resume` and the same for every node of the run.
 */
export interface RunContext {
  /** Unique per run; the same after a resume. */
  readonly runId: RunId;
  /** The conversation the run belongs to (`ExecutionOutput.thread`). */
  readonly threadId: string;
  /** Aborted by `app.cancel(thread)` or by the caller's own `signal`. */
  readonly signal: AbortSignal;
  /** `execute(…, { metadata })`, kept by the run's resumes. */
  readonly metadata: Readonly<Record<string, string>>;
  /** Who the thread belongs to (`execute(…, { owner })`); only that owner may continue it. */
  readonly owner?: string;
  /** The validated input of the workflow start the run began at (`{}` when unknown); kept by its resumes. */
  readonly input: Readonly<Record<string, unknown>>;
}

/** A run context with defaults: its own thread, a signal nobody aborts, no metadata, no input. */
export function newRunContext(context: {
  readonly runId: string;
  readonly threadId?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly metadata?: Readonly<Record<string, string>> | undefined;
  readonly owner?: string | undefined;
  readonly input?: Readonly<Record<string, unknown>> | undefined;
}): RunContext {
  return {
    runId: runIdOf(context.runId),
    threadId: context.threadId ?? context.runId,
    signal: context.signal ?? new AbortController().signal,
    metadata: context.metadata ?? {},
    input: context.input ?? {},
    ...(context.owner === undefined ? {} : { owner: context.owner }),
  };
}

/** The services of a run that live in LangGraph's `configurable` (internal). */
export interface RunServices {
  readonly run: RunContext;
  readonly executionContext?: unknown;
  readonly quorumManager?: QuorumManager;
}

/** What a node reads of its run (internal): the run context plus the services nodes need. */
export interface NodeRunContext {
  readonly run: RunContext;
  readonly runId: RunId;
  readonly threadId: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly executionContext?: unknown;
  readonly branchCancelToken?: { cancelled: boolean };
}

const isRunContext = (value: unknown): value is RunContext =>
  typeof value === "object" && value !== null && "runId" in value && "signal" in value;

/**
 * The run of a node (internal): the `RunContext` the app put into `configurable.run`; a graph run
 * without one (a slice, a bare graph in a test) gets a context of `fallbackRunId`.
 */
export function extractRunContext(
  config: RunnableConfig | undefined,
  fallbackRunId: string,
): NodeRunContext {
  const conf: Record<string, unknown> = config?.configurable ?? {};
  const run = isRunContext(conf.run)
    ? conf.run
    : newRunContext({ runId: fallbackRunId, signal: config?.signal });
  return {
    run,
    runId: run.runId,
    threadId: run.threadId,
    metadata: run.metadata,
    executionContext: conf.executionContext,
    branchCancelToken: conf.branchCancelToken as { cancelled: boolean } | undefined,
  };
}

/** A cancelled run stops before its next model or tool call. */
export function throwIfCancelled(run: RunContext): void {
  if (run.signal.aborted) throw new WorkflowCancelledError("the run was cancelled");
}

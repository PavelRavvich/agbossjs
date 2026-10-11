import type { RunContext } from "../core/run-context.js";
import type { z } from "zod";

/** What a tool may know about the run it serves. */
export interface ToolContext<TExec = unknown> {
  readonly executionContext?: TExec;
  /** The run this call is part of: its id, thread, cancel signal and metadata. */
  readonly run: RunContext;
  readonly runId: string;
  readonly workflow: string;
  readonly agent: string;
  /**
   * The id of this tool call — unique within the run, the same when the call runs again after a
   * crash (at-least-once). Tools with side effects use it as their idempotency key.
   */
  readonly callId: string;
  readonly signal: AbortSignal;
  /** Paid tools report their own cost in USD; it counts against the budgets. */
  readonly reportCost: (usd: number) => void;
  /**
   * Pauses the run to wait for external input. The run stops here; when `app.resume` is called
   * with the replyWith, the tool runs again from the start, and `pause` instantly returns the replyWith.
   * **Do not put side effects before `pause`** — they will run twice!
   */
  readonly pause: (ask: unknown) => unknown;
}

/** Tool failures are values, not exceptions: the model sees them and can recover. */
export type ToolOutput<TOutput> =
  | { readonly kind: "ok"; readonly value: TOutput }
  | { readonly kind: "error"; readonly message: string };

/** One shape for every tool — own functions and MCP facades alike. */
export interface Tool<TName extends string = string, TInput = unknown, TOutput = unknown> {
  readonly name: TName;
  readonly description: string;
  readonly channel?: string;
  readonly timeoutMs: number;
  readonly input: z.ZodType<TInput>;
  readonly output: z.ZodType<TOutput>;
  readonly invoke: (raw: unknown, ctx: ToolContext) => Promise<ToolOutput<TOutput>>;
  /** Who reported costs are billed to (default `tool:<name>`), e.g. `rag:<name>` → category retrieval. */
  readonly costCaller?: string;
}

export type AnyTool = Tool;

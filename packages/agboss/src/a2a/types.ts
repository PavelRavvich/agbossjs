import { z } from "zod";

/**
 * How a remote run ended: the app's own outcomes (`answered`, `guarded`, `paused`) and the ways a
 * run fails — stopped by a limit (`limited`), by its signal or `cancel` (`cancelled`), or any other
 * error (`failed`).
 */
export type A2AStatus = "answered" | "guarded" | "paused" | "failed" | "limited" | "cancelled";

/** `POST /execute`: the workflow start's input, and the thread to continue (omit for a new one). */
export interface A2AExecutionRequest<TInput = unknown> {
  readonly input: TInput;
  readonly thread?: string;
}

/**
 * What the caller gets back: the thread (absent when the run failed before it had one), the final
 * status, the workflow's reply, and — when it reached a workflow finish — the finish and its output.
 */
export interface A2AExecutionResponse {
  readonly thread?: string;
  readonly status: A2AStatus;
  readonly reply: string;
  readonly finish?: string;
  readonly output?: unknown;
  /** Why the run failed, was limited or cancelled. */
  readonly error?: string;
}

/** Payload for resuming a paused execution. */
export interface A2AResumeRequest<TDecision = unknown> {
  readonly decision: TDecision;
}

/**
 * Server-sent events of one run: `progress` while it runs (a text delta or a tool call), then one
 * `finish` with the final response — whatever the status.
 */
export type A2AEvent =
  | {
      readonly type: "progress";
      readonly payload: { readonly step: "text" | "tool"; readonly content: string };
    }
  | { readonly type: "finish"; readonly payload: { readonly result: A2AExecutionResponse } };

const statusSchema = z.enum(["answered", "guarded", "paused", "failed", "limited", "cancelled"]);

/** The wire shape of a response (what a client accepts from a remote agent). */
export const A2AResponseSchema = z.object({
  thread: z.string().optional(),
  status: statusSchema,
  reply: z.string(),
  finish: z.string().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
});

/** The wire shape of an event. */
export const A2AEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("progress"),
    payload: z.object({ step: z.enum(["text", "tool"]), content: z.string() }),
  }),
  z.object({ type: z.literal("finish"), payload: z.object({ result: A2AResponseSchema }) }),
]);

/** The wire shape of a request (what the server accepts). */
export const A2ARequestSchema = z.object({
  input: z.unknown(),
  thread: z.string().optional(),
});

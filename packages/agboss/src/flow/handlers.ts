import type { RunContext } from "../core/run-context.js";
import type { InputOf, NoOutput, OutputOf, Route } from "./generated-types.js";

/**
 * The handler contracts of the v2 nodes (#270 → one handler contract): `implements <Kind>Handler<Self>`
 * and the method takes `InputOf<Self>` — generated, never written by hand, so it cannot disagree
 * with the decorator or the graph. Before generation `InputOf<Self>` is `MissingGeneratedTypes`.
 */

/** What an action's `execute` resolves to: its output, nothing without `output`. */
export type ActionResult<TOutput> = [TOutput] extends [NoOutput] ? Promise<void> : Promise<TOutput>;

/** What an action knows of its run besides its input (optional to declare: `execute(input)` is enough). */
export interface ActionContext<TContext = unknown> {
  /** The run: its id, thread, signal, metadata, owner and start input. */
  readonly run: RunContext;
  /** `${runId}:${node}:${visit}` — the same after a resume, another on the node's next visit. */
  readonly idempotencyKey: string;
  /** What the caller passed as `execute(…, { executionContext })` — in memory only, never checkpointed. */
  readonly executionContext?: TContext;
}

/** `@Action`: `execute(input)` — `Promise<OutputOf<Self>>`, `Promise<void>` without `output`. */
export interface ActionHandler<TSelf> {
  execute(input: InputOf<TSelf>, ctx: ActionContext): ActionResult<OutputOf<TSelf>>;
}

/** `@WorkflowFinish` with `input`: builds the execution's output. */
export interface FinishHandler<TSelf> {
  finish(input: InputOf<TSelf>): OutputOf<TSelf> | Promise<OutputOf<TSelf>>;
}

/** A code router (#280): returns one target, or several for a parallel launch. */
export interface RouterHandler<TSelf> {
  route(input: InputOf<TSelf>): Route<TSelf> | readonly Route<TSelf>[];
}

/** A tool: its input is the plain DTO of the model's call, not `Produced` (#270, Q53). */
export interface ToolHandler<TSelf> {
  run(input: InputOf<TSelf>): Promise<OutputOf<TSelf>>;
}

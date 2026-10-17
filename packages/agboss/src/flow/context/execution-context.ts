import type { Class } from "../../components/injection.js";

/**
 * The execution context (#280): the one context of an execution, injected through the
 * constructor (`deps: [ExecutionContext]`, `constructor(private readonly executionContext:
 * ExecutionContext)`). It holds data about the current execution and its current step only — no
 * container, no I/O — and is read-only. Wiki → Components.
 */

/** A `@Workflow` class (`executionOf(W)`, `WorkflowDescriptor.type`). */
export type WorkflowClass = Class;

/** A component in the live context: its class and its `name` (the stable key, #272). */
export interface ComponentDescriptor {
  readonly type: Class;
  readonly name: string;
}

/** The workflow an execution runs: its class, `name`, the version now and the one it started on. */
export interface WorkflowDescriptor {
  readonly type: WorkflowClass;
  readonly name: string;
  readonly version: string;
  /** The version the execution started on (differs from `version` after a deploy and a resume). */
  readonly startedVersion: string;
}

/** One visit of a node: different in each parallel branch and in each tool call. */
export interface StepDescriptor {
  readonly component: ComponentDescriptor;
  /** The node's id in `result.path`, traces and the key: its `name` (`critic-agent#2` for a copy). */
  readonly nodeId: string;
  /** The pass through this node in the execution, from 1 — the counter `maxVisits` checks. */
  readonly visitNumber: number;
  /** `${executionId}:${nodeId}:${visitNumber}[:${itemIndex}][:${callId}]` — the same on a retry. */
  readonly idempotencyKey: string;
  /** The model's tool-call id while a tool call runs; `undefined` everywhere else. */
  readonly callId: string | undefined;
  /** The item's index in a per-item launch (#273), from 0; `undefined` otherwise. */
  readonly itemIndex: number | undefined;
  /** Which copy of a repeated agent this is (#273), from 1; `1` when the agent is not repeated. */
  readonly copyNumber: number;
}

/**
 * The current execution: the type and the DI token. The injected object is not a snapshot — every
 * read gives the current execution and step; a read outside an execution, or after the step it
 * belongs to ended, throws `ExecutionContextUnavailableError`.
 */
export abstract class ExecutionContext {
  /** Unique per execution; the same after a resume. */
  abstract readonly executionId: string;
  /** The conversation the execution belongs to (`ExecutionOutput.thread`). */
  abstract readonly threadId: string;
  /** Who the thread belongs to (`execute(…, { owner })`); `undefined` for a thread without one. */
  abstract readonly ownerId: string | undefined;
  /** Aborted by `app.cancel(thread)` or by the caller's own `signal`. */
  abstract readonly signal: AbortSignal;
  abstract readonly workflow: WorkflowDescriptor;
  abstract readonly step: StepDescriptor;
  /** The index of a child launched per item (#263); `undefined` for a root or a single child. */
  abstract readonly itemIndex: number | undefined;
  /** The parent execution, `undefined` at the root (one level until #263). */
  abstract readonly parent: this | undefined;
  /** The root execution; `root === this` at the root. */
  abstract readonly root: this;
  /** The level in the execution tree, from 1 at the root. */
  abstract readonly depth: number;
  /** The nearest execution of `workflow` in the chain, this one included; `undefined` when none. */
  abstract executionOf(workflow: WorkflowClass): this | undefined;
}

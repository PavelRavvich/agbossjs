import type { Class } from "../components/injection.js";
import type { FlowNodeClass } from "./flow-node.js";
import { routerChoice } from "./router-targets.js";

export type { FlowNodeClass, FlowNodeInstance } from "./flow-node.js";

/**
 * A second place in the flow for a class that is already a node: declared **once** as a constant,
 * `const StyleReview = node(ReviewerAgent, "style-review")`, and referenced by that constant.
 */
export interface NamedNode {
  readonly kind: "named-node";
  readonly use: FlowNodeClass;
  readonly name: string;
}

/** `Self` in a router's `choose(...)` / `route(...)`: the node the router was called after. */
export interface SelfTarget {
  readonly kind: "self";
}

export const Self: SelfTarget = Object.freeze({ kind: "self" });

/** A node of the flow: a decorated class (`@WorkflowStart`, `@Router`, `@Agent`, `@WorkflowFinish`) or a named node. */
export type FlowNode = FlowNodeClass | NamedNode;

export interface BackgroundTarget {
  readonly kind: "background";
  readonly target: FlowNode;
}

export type ParallelTarget = FlowNode | BackgroundTarget;

export function background(target: FlowNode): BackgroundTarget {
  return { kind: "background", target };
}

export const bg = background;

export const unwrapTarget = (target: ParallelTarget): FlowNode =>
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  typeof target === "object" && target !== null && "kind" in target && target.kind === "background"
    ? target.target
    : target;

/** What a router may choose: a node or `Self`. */
export interface ReturnTarget {
  readonly kind: "return";
}
export interface EndTarget {
  readonly kind: "end";
}

export interface ParallelGroup {
  readonly kind: "parallel";
  readonly targets: readonly ChoiceTarget[];
  readonly quorumRouter?: Class;
  readonly quorumMin?: number;
}

export interface OptionalTarget {
  readonly kind: "optional";
  readonly target: ChoiceTarget;
}

export function parallel(...targets: readonly [ChoiceTarget, ...ChoiceTarget[]]): ParallelGroup {
  // Validate no Self or Skip inside
  for (const t of targets) {
    if (isSelf(t) || isReturn(t) || isEnd(t)) {
      throw new Error("Cannot use Self or Skip inside parallel()");
    }
  }
  return { kind: "parallel", targets };
}

export function optional(target: ChoiceTarget): OptionalTarget {
  return { kind: "optional", target };
}

export const isParallel = (t: unknown): t is ParallelGroup =>
  typeof t === "object" && t !== null && "kind" in t && t.kind === "parallel";
export const isOptional = (t: unknown): t is OptionalTarget =>
  typeof t === "object" && t !== null && "kind" in t && t.kind === "optional";

export type ChoiceTarget =
  FlowNode | SelfTarget | ReturnTarget | EndTarget | ParallelGroup | OptionalTarget;

/** `from(A, B).next(C)` — an unconditional step from every source. */
export interface ToStep {
  readonly kind: "to";
  readonly from: readonly FlowNode[];
  readonly targets: readonly ParallelTarget[];
}

/** `catchError(A).next(B)` — where a failed node goes. */
export interface CatchStep {
  readonly kind: "catch";
  readonly target: FlowNode;
  readonly errorType: Class;
  readonly nextNode: FlowNode;
}

/** `from(Router).routes()` — the router picks one of its `@Router({ routes })` targets. */
export interface ChooseStep {
  readonly kind: "choose";
  readonly from: readonly FlowNode[];
  readonly targets: readonly ChoiceTarget[];
  readonly quorumRouter?: Class;
  readonly quorumMin?: number;
  readonly quorumMax?: number;
  readonly quorumTimeoutSeconds?: number;
}

/** `chain(A, B, C)` = `from(A).next(B)` + `from(B).next(C)`; a router only as the last element. */
export interface ChainStep {
  readonly kind: "chain";
  readonly nodes: readonly FlowNode[];
}

interface JoinStep {
  readonly kind: "join";
  readonly from: readonly FlowNode[];
  readonly target: FlowNode;
}

export interface BatchParallelStep {
  readonly kind: "batchParallel";
  readonly from: readonly FlowNode[];
  readonly target: FlowNode;
  readonly strategy: Class;
  readonly options: { concurrencyLimit: number; batchSize: number };
}

interface JoinAnyStep {
  readonly kind: "joinAny";
  readonly from: readonly FlowNode[];
  readonly target: FlowNode;
}

interface JoinQuorumStep {
  readonly kind: "joinQuorum";
  readonly count: number;
  readonly from: readonly FlowNode[];
  readonly target: FlowNode;
}

export type FlowStep =
  | ToStep
  | ChooseStep
  | CatchStep
  | ChainStep
  | JoinStep
  | BatchParallelStep
  | JoinAnyStep
  | JoinQuorumStep;

/** The graph of a workflow: its transitions, in the workflow file. */
export type Flow = readonly FlowStep[];

/** What `from(...)` returns: the step's kind is chosen next. */
export interface FlowSource {
  readonly next: (target: FlowNode) => ToStep;
  readonly nextParallel: (...targets: readonly [FlowNode, ...FlowNode[]]) => ToStep;
  readonly join: (target: FlowNode) => JoinStep;
  readonly batchParallel: (
    target: FlowNode,
    strategy: Class,
    options: { concurrencyLimit: number; batchSize: number },
  ) => BatchParallelStep; // Simplified for runtime AST
  /** The router picks one of the targets of its `@Router({ routes })` — the one list of them. */
  readonly routes: () => ChooseStep;
  readonly joinQuorum: (
    router: Class,
    options: { min: number; max?: number; timeoutSeconds?: number },
  ) => {
    routes: (...targets: readonly [ChoiceTarget, ...ChoiceTarget[]]) => ChooseStep;
  };
}

/** Starts a transition from one or more nodes (several = fan-in). */
export const Return: ChoiceTarget = Object.freeze({ kind: "return" });
export const End: ChoiceTarget = Object.freeze({ kind: "end" });

export function from(...sources: readonly [FlowNode, ...FlowNode[]]): FlowSource {
  return {
    next: (target) => ({ kind: "to", from: sources, targets: [target] }),
    nextParallel: (...targets) => ({ kind: "to", from: sources, targets }),
    join: (target) => ({ kind: "join", from: sources, target }),
    batchParallel: (target, strategy, options) => ({
      kind: "batchParallel",
      from: sources,
      target,
      strategy,
      options,
    }),
    routes: () => routerChoice(sources),
    joinQuorum: (router, options) => ({
      routes: (...targets) => ({
        kind: "choose",
        from: sources,
        targets,
        quorumRouter: router,
        quorumMin: options.min,
        quorumMax: options.max,
        quorumTimeoutSeconds: options.timeoutSeconds,
      }),
    }),
  };
}

/** A straight line of unconditional steps. */
export function chain(...nodes: readonly [FlowNode, FlowNode, ...FlowNode[]]): ChainStep {
  return { kind: "chain", nodes };
}

/** A second place for the same class under its own name. Declare it once, as a constant. */
export function node(use: FlowNodeClass, name: string): NamedNode {
  return Object.freeze({ kind: "named-node", use, name });
}

export const isBackgroundTarget = (target: ParallelTarget): target is BackgroundTarget =>
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  typeof target === "object" && target !== null && "kind" in target && target.kind === "background";
export const isSelf = (target: ChoiceTarget): target is SelfTarget =>
  typeof target === "object" && target.kind === "self";
export const isReturn = (target: ChoiceTarget): target is ReturnTarget =>
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  typeof target === "object" && target !== null && target.kind === "return";
export const isEnd = (target: ChoiceTarget): target is EndTarget =>
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  typeof target === "object" && target !== null && target.kind === "end";

export const isNamedNode = (target: ChoiceTarget): target is NamedNode =>
  typeof target === "object" && target.kind === "named-node";

/** The label a person reads in an error: the class name, or the named node's name and class. */
export function labelOf(target: ChoiceTarget): string {
  if (isSelf(target)) return "Self";
  if (isReturn(target)) return "Return";
  if (isEnd(target)) return "End";
  if (isNamedNode(target)) return `node(${target.use.name}, "${target.name}")`;
  if (isParallel(target)) return `parallel(${target.targets.map(labelOf).join(", ")})`;
  if (isOptional(target)) return `optional(${labelOf(target.target)})`;
  return target.name || "(anonymous class)";
}

/**
 * When `target` fails with `errorType` (or a subclass, or an error caused by one), go to the next
 * node instead of failing the run. Matching is by the class's stable `code` (`BudgetExceededError.code`,
 * …; a user class without a `static code` matches by its name), so it still works on a run resumed
 * from a checkpoint. `Error` (the default) catches everything. `compensateWith` is `next` under
 * another name, for a compensating target (`LocalSagaStrategy`).
 */
export function catchError(
  target: FlowNode,
  errorType: Class = Error,
): { next: (nextNode: FlowNode) => CatchStep; compensateWith: (nextNode: FlowNode) => CatchStep } {
  return {
    next: (nextNode) => ({ kind: "catch", target, errorType, nextNode }),
    compensateWith: (nextNode) => ({ kind: "catch", target, errorType, nextNode }),
  };
}

import type { Class } from "../components/injection.js";
import type { DtoClass } from "../dto/types.js";
import type { ValueShape } from "./dto-wrappers.js";

/**
 * The graph of a v2 workflow as data (#272 → The AST): `@Workflow({ flow })` holds one `FlowPath`
 * per path. The builder (`builder.ts`) writes it; the analyser (PR 2) and the runtime (PR 4) read it.
 * Parallel steps (#273, #279) and child workflows (#263) extend `Step` by new members.
 */

/** What a node of the graph is. The values are the kind suffixes of component names. */
export enum NodeKind {
  Start = "workflow-start",
  Finish = "workflow-finish",
  Agent = "agent",
  Action = "action",
  Router = "router",
  Workflow = "workflow",
}

/** What a step of a path does. */
export enum StepKind {
  Returns = "returns",
  To = "to",
  Switch = "switch",
  ChooseOne = "choose-one",
  OnError = "on-error",
}

/** A decorated component class: an agent, an action, a router, a finish or a workflow. */
export type ComponentClass = Class;

/** A `@WorkflowStart` class. */
export type StartClass = Class;

/** An error class `.onError(…)` catches (matched by its stable `code` through the cause chain). */
export type ErrorClass = abstract new (...args: never[]) => Error;

/** A path's first node: a start, or the shared node whose own path it is. */
export type PathSource = StartSource | ComponentSource;

export interface StartSource {
  readonly kind: NodeKind.Start;
  readonly node: StartClass;
}

export interface ComponentSource {
  readonly kind: NodeKind.Agent | NodeKind.Action | NodeKind.Router | NodeKind.Workflow;
  readonly node: ComponentClass;
}

/** One value a `.returns(…)` puts on the path: `XDto`, `listOf(XDto)`, `optional(XDto)`, with a tag. */
export interface ReturnedValue {
  readonly shape: ValueShape;
  /** `{ as: "before" }` — the tag a field of that name reads (#270). */
  readonly as?: string;
}

export interface ReturnsStep {
  readonly kind: StepKind.Returns;
  readonly values: readonly ReturnedValue[];
}

/** `.toAgent` / `.toRouter` / `.toAction` / `.toFinish`: the kind is the transition's. */
export interface ToStep {
  readonly kind: StepKind.To;
  readonly target: ComponentClass;
  readonly targetKind: NodeKind;
}

/** One `caseOf(XDto)…` of a `.switch(…)`. */
export interface SwitchCase {
  readonly dto: DtoClass;
  readonly tag?: string;
  readonly path: SubPath;
}

export interface SwitchStep {
  readonly kind: StepKind.Switch;
  readonly cases: readonly SwitchCase[];
}

/** One `route(X)…` of a `.chooseOne(…)`: its target and what follows it. */
export interface ChooseOneRoute {
  readonly target: ComponentClass;
  readonly path: SubPath;
}

export interface ChooseOneStep {
  readonly kind: StepKind.ChooseOne;
  readonly routes: readonly ChooseOneRoute[];
}

/** `.onError(ErrorClass, toAction(X)…)`: the side path the step's failure takes. */
export interface OnErrorStep {
  readonly kind: StepKind.OnError;
  readonly error: ErrorClass;
  readonly path: SubPath;
}

export type Step = ReturnsStep | ToStep | SwitchStep | ChooseOneStep | OnErrorStep;

/** The steps inside `route(X)…`, `caseOf(D)…` or the side path of `.onError`. */
export interface SubPath {
  readonly steps: readonly Step[];
}

/** One entry of `@Workflow({ flow })`: a source and its steps, in order. */
export interface FlowPath {
  readonly source: PathSource;
  readonly steps: readonly Step[];
}

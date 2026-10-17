import { callerFile } from "../../components/call-site.js";
import type { Class, ResolvedAll, Token } from "../../components/injection.js";
import type { AgentMeta } from "../../components/meta-types.js";
import { NodeKind, type ComponentClass } from "../ast.js";
import { declared, recordDeclaration, type InputFields } from "./declaration.js";

/** Who decides a router's route (#280): its model, or its class's `route(input)`. */
export enum DecidedBy {
  /** The router's `model` (a decision model like Jev, or a chat model) picks a route. */
  Model = "model",
  /** The class's `route(input)` (`implements RouterHandler<Self>`) picks it: no model call, cost 0. */
  Code = "code",
}

/**
 * Whether a router's target is launched by the framework or chosen by the router (#273, #280):
 * only before `.toParallelAgents(…)`; with `.chooseOne(…)` it fails assembly.
 */
export enum SpawnPolicy {
  /** Launched by the framework next to the chosen ones; never returned by `route()`. */
  Always = "always",
  /** Launched when the router chooses it (the default). */
  OnDemand = "on-demand",
}

/** What a failed agent of a parallel launch does to the launch (#273): only before `.toParallelAgents(…)`. */
export enum FailurePolicy {
  /** The launch fails (the default). */
  FailFast = "fail-fast",
  /** The failed agent drops out of the join; the execution goes on. */
  Skip = "skip",
}

/** A model router's route its model chooses: what choosing it means. */
export interface ChosenRouterRoute {
  /** An agent, an action, another router or a finish — the same targets as `chooseOne(route(…))`. */
  readonly target: ComponentClass;
  /** A route to a finish is worded as a stop instruction ("Stop and send the answer: …"). */
  readonly prompt: string;
  readonly spawn?: SpawnPolicy.OnDemand;
  readonly failure?: FailurePolicy;
}

/** A route the framework launches itself (`spawn: SpawnPolicy.Always`): no model sees it. */
export interface AlwaysRouterRoute {
  readonly target: ComponentClass;
  readonly spawn: SpawnPolicy.Always;
  readonly failure?: FailurePolicy;
  readonly prompt?: never;
}

/** One route of a model router (`DecidedBy.Model`). */
export type RouterRoute = ChosenRouterRoute | AlwaysRouterRoute;

/** One route of a code router (`DecidedBy.Code`): its `route()` says when; no prompt. */
export interface CodeRouterRoute {
  readonly target: ComponentClass;
  readonly spawn?: SpawnPolicy;
  readonly failure?: FailurePolicy;
  readonly prompt?: never;
}

/** What both kinds of router declare. */
interface RouterBase {
  /** Ends with `-router` (`main-router`). */
  readonly name: string;
  readonly description: string;
  /** What it decides on, by type; required and non-empty (`[router.empty-input]`). */
  readonly input: InputFields;
  /** Visits per execution; one more fails before it decides (`VisitsLimitExceededError`). */
  readonly maxVisits?: number;
}

/**
 * `@Router({ decidedBy: DecidedBy.Model })` — how its model chooses (`prompt`, the route prompts);
 * the flow lists the targets (`.chooseOne(route(…)…)`) and the two lists match (`[router.routes-mismatch]`).
 */
export interface ModelRouterOptions extends RouterBase {
  readonly decidedBy: DecidedBy.Model;
  readonly routes: readonly [RouterRoute, ...RouterRoute[]];
  /** A decision model (Jev, …) or a chat model; `defaults.router.model` when absent. */
  readonly model?: string;
  /** How to choose: inline, and / or files next to the router (read at assembly). */
  readonly prompt?: string;
  readonly promptUrls?: readonly string[];
  /** Static `{{key}}` values of the prompt. */
  readonly promptVariables?: AgentMeta["promptVariables"];
  readonly deps?: never;
}

/** `@Router({ decidedBy: DecidedBy.Code })` — the class's `route(input)` chooses; no model, no prompt. */
export interface CodeRouterOptions<
  TDeps extends readonly Token[] = readonly Token[],
> extends RouterBase {
  readonly decidedBy: DecidedBy.Code;
  readonly routes: readonly [CodeRouterRoute, ...CodeRouterRoute[]];
  /** Constructor dependencies, in order; checked against the constructor by the compiler. */
  readonly deps?: TDeps;
  readonly model?: never;
  readonly prompt?: never;
  readonly promptUrls?: never;
  readonly promptVariables?: never;
}

/** `@Router` options: a union discriminated by `decidedBy`. */
export type RouterOptions = ModelRouterOptions | CodeRouterOptions;

/** A model router's class has no `route` (a code router's handler): a compile error. */
export type NoRouteMethod<TClass extends Class> =
  InstanceType<TClass> extends { readonly route: unknown }
    ? { readonly __error: "a model router has no route() — routes are chosen by its model" }
    : unknown;

/** What a code router's class has: `route(input)` (`implements RouterHandler<Self>`). */
export interface RouteMethod {
  route(input: never): unknown;
}

/** The decorator of a model router. */
export type ModelRouterDecorator = <TClass extends new () => object>(
  value: TClass & NoRouteMethod<TClass>,
) => TClass;

/** The decorator of a code router: the class implements `route(input)`, its constructor takes `deps`. */
export type CodeRouterDecorator<TDeps extends readonly Token[]> = <
  TClass extends new (...args: ResolvedAll<TDeps>) => RouteMethod,
>(
  value: TClass,
) => TClass;

/** A router its model decides (`DecidedBy.Model`): the class has no `route()`. */
export function Router(options: ModelRouterOptions): ModelRouterDecorator;
/** A router its class decides (`DecidedBy.Code`): `implements RouterHandler<Self>`, `deps` in its constructor. */
export function Router<const TDeps extends readonly Token[] = []>(
  options: CodeRouterOptions<TDeps>,
): CodeRouterDecorator<TDeps>;
export function Router(options: RouterOptions): <TClass extends Class>(value: TClass) => TClass {
  const source = callerFile();
  return <TClass extends Class>(value: TClass): TClass => {
    recordDeclaration(value, declared(NodeKind.Router, options, source));
    return value;
  };
}

/** Whether a router is decided by code. */
export const isCodeRouter = (options: RouterOptions): options is CodeRouterOptions =>
  options.decidedBy === DecidedBy.Code;

/** The routes the router decides on: every route but those the framework launches itself. */
export const chosenRoutesOf = (
  options: RouterOptions,
): readonly (ChosenRouterRoute | CodeRouterRoute)[] => {
  const routes: readonly (RouterRoute | CodeRouterRoute)[] = options.routes;
  return routes.filter(
    (route): route is ChosenRouterRoute | CodeRouterRoute => route.spawn !== SpawnPolicy.Always,
  );
};

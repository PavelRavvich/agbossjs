import { callerFile } from "../../components/call-site.js";
import type { Class } from "../../components/injection.js";
import { NodeKind, type ComponentClass } from "../ast.js";
import { declared, recordDeclaration, type InputFields } from "./declaration.js";

/** Who decides a router's route. The core ships model routers; #280 adds `Code`. */
export enum DecidedBy {
  Model = "model",
}

/** One route of `@Router({ routes })`: the target and when to take it (how to choose). */
export interface RouterRoute {
  /** An agent, an action, another router or a finish — the same targets as `chooseOne(route(…))`. */
  readonly target: ComponentClass;
  /** A route to a finish is worded as a stop instruction ("Stop and send the answer: …"). */
  readonly prompt: string;
}

/**
 * `@Router` — how to choose (`prompt`, the route prompts); the flow lists the targets
 * (`.chooseOne(route(…)…)`) and the two lists must match (`[router.routes-mismatch]`, PR 2).
 */
export interface RouterOptions {
  /** Ends with `-router` (`main-router`). */
  readonly name: string;
  readonly description: string;
  readonly decidedBy: DecidedBy.Model;
  /** What the model sees, by type; required and non-empty (`[router.empty-input]`). */
  readonly input: InputFields;
  readonly routes: readonly [RouterRoute, ...RouterRoute[]];
  /** A decision model (Jev, …) or a chat model; `defaults.router.model` when absent. */
  readonly model?: string;
  readonly prompt?: string;
  /** Visits per execution; one more fails before the model call (`VisitsLimitExceededError`). */
  readonly maxVisits?: number;
}

/** A model router's class has no `route` (a code router's handler, #280): a compile error. */
export type NoRouteMethod<TClass extends Class> =
  InstanceType<TClass> extends { readonly route: unknown }
    ? { readonly __error: "a model router has no route() — routes are chosen by its model" }
    : unknown;

export function Router(options: RouterOptions) {
  const source = callerFile();
  return <TClass extends new () => object>(value: TClass & NoRouteMethod<TClass>): TClass => {
    recordDeclaration(value, declared(NodeKind.Router, options, source));
    return value;
  };
}

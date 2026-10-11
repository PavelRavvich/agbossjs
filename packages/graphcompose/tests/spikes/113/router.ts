/**
 * Spike #113 — a router's `routes` against its `choose(...)` in the workflow's `flow`. Not framework API.
 *
 * Only a startup check is possible: `routes` live in the decorator's options (never in the class's
 * type), and the node classes themselves are empty (`class BillingAgent {}`), so to the compiler
 * every agent, router and conclusion is the same type `{}`.
 */
import type { Class } from "../../../src/components/injection.js";

/** "The node the router was called after." */
export const Self: unique symbol = Symbol("Self");

type RouteTarget = Class | typeof Self;

export interface Route {
  readonly to: RouteTarget;
  readonly prompt: string;
}

export const route = (to: RouteTarget, prompt: string): Route => ({ to, prompt });

const nodes = new WeakMap<object, string>();

/** Stands for `@Agent` here: only marks the class as a component (the class body stays empty). */
export function Agent(name: string) {
  return (value: Class): void => {
    nodes.set(value, name);
  };
}

const routers = new WeakMap<object, readonly Route[]>();

export function Router(options: { readonly name: string; readonly routes: readonly Route[] }) {
  return (value: Class): void => {
    routers.set(value, options.routes);
  };
}

export interface Choice {
  readonly router: Class;
  readonly options: readonly RouteTarget[];
}

export const from = (router: Class): { choose(...options: RouteTarget[]): Choice } => ({
  choose: (...options) => ({ router, options }),
});

const nameOf = (target: RouteTarget): string => (target === Self ? "Self" : target.name);

/** The assembly rule: a route without a choice, or a choice without a route, fails with a message. */
export function assertRoutesMatchChoose(choice: Choice): void {
  const routed = (routers.get(choice.router) ?? []).map((each) => each.to);
  const unrouted = choice.options.filter((option) => !routed.includes(option));
  const unchosen = routed.filter((target) => !choice.options.includes(target));
  const problems = [
    ...unrouted.map((option) => `${nameOf(option)} is chosen but has no route`),
    ...unchosen.map((target) => `${nameOf(target)} has a route but is not in choose(...)`),
  ];
  if (problems.length > 0) {
    throw new Error(`router.routes-mismatch: ${choice.router.name}: ${problems.join("; ")}`);
  }
}

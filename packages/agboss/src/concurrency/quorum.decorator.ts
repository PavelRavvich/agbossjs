import { callerFile } from "../components/call-site.js";
import type { Class } from "../components/injection.js";
import { recordNode } from "../graph/node-kind.js";

/** Strategy for evaluating and routing a quorum of parallel branches. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface QuorumStrategy<T = any> {
  filterVote(state: T): Promise<boolean> | boolean;
  route(
    state: T,
    hasQuorum: boolean,
  ): Promise<import("../graph/flow.js").ChoiceTarget> | import("../graph/flow.js").ChoiceTarget;
}

export interface QuorumRouterOptions {
  readonly name?: string;
}

export interface QuorumRouterMeta extends QuorumRouterOptions {
  readonly source?: string;
}

const quorumRouters = new WeakMap<Class, QuorumRouterMeta>();

/**
 * `@QuorumRouter` — an active barrier that intercepts parallel branches as they finish.
 * It counts votes using `filterVote()` and cancels remaining branches as soon as `min` is reached.
 */
export function QuorumRouter(options?: QuorumRouterOptions) {
  const source = callerFile();
  const opts = options ?? {};
  return <C extends Class>(value: C): C => {
    recordNode(value, { kind: "quorumRouter", name: opts.name ?? value.name });
    quorumRouters.set(value, source === undefined ? opts : { ...opts, source });
    return value;
  };
}

export const quorumRouterMetaOf = (target: Class): QuorumRouterMeta | undefined =>
  quorumRouters.get(target);

import { callerFile } from "../components/call-site.js";
import type { Class } from "../components/injection.js";
import { recordNode } from "./node-kind.js";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { PromptOptions } from "../components/prompt-options.js";
import type { RouteDeclaration } from "./route.js";

/**
 * `@Router` — a node that picks the next node. Its prompt (`prompt` and / or `promptUrls`) says
 * **how** to choose; `routes` say **what** each choice means and must equal its `choose(...)`.
 */
export interface RouterOptions {
  readonly name: string;
  readonly description: string;
  readonly prompt?: string;
  readonly promptUrls?: readonly string[];
  /** The router's own model: Jev (`typesafe/jev-*`) or any chat model. */
  readonly model: string;
  /** How many times one run may pass through this router; no limit when absent. */
  readonly maxVisits?: number;
  readonly routes: readonly [RouteDeclaration, ...RouteDeclaration[]];
}

/** What `@Router` recorded: its options and the file it is declared in (for `promptUrls`). */
export interface RouterMeta extends RouterOptions {
  readonly source?: string;
}

const routers = new WeakMap<Class, RouterMeta>();

export function Router(options: RouterOptions) {
  const source = callerFile();
  return <C extends Class>(value: C): C => {
    recordNode(value, { kind: "router", name: options.name });
    routers.set(value, source === undefined ? options : { ...options, source });
    return value;
  };
}

/** The options `@Router` recorded on a class. */
export const routerMetaOf = (target: Class): RouterMeta | undefined => routers.get(target);

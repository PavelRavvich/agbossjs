import type { MessageContent } from "@langchain/core/messages";
import type { UsageRecord } from "../finops/usage.js";

/** A target the router may pick. */
export interface RouteOption {
  readonly name: string;
  readonly description: string;
}

/**
 * Everything a router sees: rendered input text and the options.
 * Routers know nothing about graph state, agents or contributions.
 */
export interface RouteRequest {
  readonly input: MessageContent;
  readonly options: readonly RouteOption[];
  /** The question to routeTo; default: "which option should handle this next?". */
  readonly instructions?: string;
}

export interface RouterDecision {
  readonly next: string;
  readonly reason: string;
  /** Probability of `next` when the strategy reports one (Jev); absent for LLM routers. */
  readonly confidence?: number;
}

/** `usage` is absent only when no model was called (single or no option). */
export type RouteOutcome =
  | { readonly kind: "decided"; readonly decision: RouterDecision; readonly usage?: UsageRecord }
  | {
      readonly kind: "failed";
      readonly reason: string;
      readonly usage?: UsageRecord;
      /** The model answered with an option that is not among the request's options. */
      readonly unknownOption?: string;
    };

/** A routing strategy (Jev, LLM, …). Pure input → outcome; testable on its own. */
export interface RouterEngine {
  readonly name: string;
  readonly route: (request: RouteRequest) => Promise<RouteOutcome>;
}

/** Usage caller id for a router, e.g. "router:main". */
export const routerCaller = (name: string): string => `router:${name}`;

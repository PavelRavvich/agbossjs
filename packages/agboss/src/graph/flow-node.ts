import type { Class } from "../components/injection.js";

/**
 * What a flow node's instance may have: nothing (`@Agent`, `@Router`, `@WorkflowFinish`), the start's
 * declared `input`, an action's `execute`, a nested workflow's `settings`, a join's `onJoin` or lifecycle hooks. A class
 * with other members only (a service, a tool, a judge) is not a flow node, so the compiler rejects
 * it: "Type 'JobFitJudge' has no properties in common with type 'FlowNodeInstance'".
 */
export interface FlowNodeInstance {
  readonly input?: unknown;
  readonly execute?: unknown;
  readonly settings?: unknown;
  readonly onJoin?: unknown;
  readonly onInit?: unknown;
  readonly onStart?: unknown;
  readonly onStop?: unknown;
}

/** A class that can be a node of the flow (see `FlowNodeInstance`). */
export type FlowNodeClass = Class<FlowNodeInstance>;

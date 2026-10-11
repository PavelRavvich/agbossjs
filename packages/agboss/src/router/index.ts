/**
 * `agboss/router` — deprecated (#195): the flow DSL and the start / router / finish
 * decorators moved to the root entry `agboss`. `agboss migrate imports` rewrites the imports;
 * this entry is removed in the next minor release.
 */
export {
  /** @deprecated Import from "agboss" (#195). */
  catchError,
  /** @deprecated Import from "agboss" (#195). */
  chain,
  /** @deprecated Import from "agboss" (#195). */
  type ChainStep,
  /** @deprecated Import from "agboss" (#195). */
  type ChoiceTarget,
  /** @deprecated Import from "agboss" (#195). */
  type ChooseStep,
  /** @deprecated Import from "agboss" (#195). */
  End,
  /** @deprecated Import from "agboss" (#195). */
  type EndTarget,
  /** @deprecated Import from "agboss" (#195). */
  type Flow,
  /** @deprecated Import from "agboss" (#195). */
  type FlowNode,
  /** @deprecated Import from "agboss" (#195). */
  type FlowNodeClass,
  /** @deprecated Import from "agboss" (#195). */
  type FlowNodeInstance,
  /** @deprecated Import from "agboss" (#195). */
  type FlowSource,
  /** @deprecated Import from "agboss" (#195). */
  type FlowStep,
  /** @deprecated Import from "agboss" (#195). */
  from,
  /** @deprecated Import from "agboss" (#195). */
  type NamedNode,
  /** @deprecated Import from "agboss" (#195). */
  Return,
  /** @deprecated Import from "agboss" (#195). */
  type ReturnTarget,
  /** @deprecated Import from "agboss" (#195). */
  type RouteDeclaration,
  /** @deprecated Import from "agboss" (#195). */
  Router,
  /** @deprecated Import from "agboss" (#195). */
  type RouterOptions,
  /** @deprecated Import from "agboss" (#195). */
  Self,
  /** @deprecated Import from "agboss" (#195). */
  type SelfTarget,
  /** @deprecated Import from "agboss" (#195). */
  type StartInputOf,
  /** @deprecated Import from "agboss" (#195). */
  type ToStep,
  /** @deprecated Import from "agboss" (#195). */
  WorkflowFinish,
  /** @deprecated Import from "agboss" (#195). */
  type WorkflowFinishOptions,
  /** @deprecated Import from "agboss" (#195). */
  WorkflowStart,
  /** @deprecated Import from "agboss" (#195). */
  type WorkflowStartClass,
  /** @deprecated Import from "agboss" (#195). */
  type WorkflowStartOptions,
} from "../index.js";

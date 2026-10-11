/**
 * `agboss/concurrency` — deprecated (#195): the batch and quorum strategies moved to the
 * root entry `agboss`. `agboss migrate imports` rewrites the imports; this entry is removed in
 * the next minor release.
 */
export {
  /** @deprecated Import from "agboss" (#195). */
  BatchParallelStrategy,
  /** @deprecated Import from "agboss" (#195). */
  type BatchParallelStrategyMeta,
  /** @deprecated Import from "agboss" (#195). */
  batchParallelStrategyMetaOf,
  /** @deprecated Import from "agboss" (#195). */
  type BatchParallelStrategyOptions,
  /** @deprecated Import from "agboss" (#195). */
  type BranchCancelToken,
  /** @deprecated Import from "agboss" (#195). */
  QuorumCancelledError,
  /** @deprecated Import from "agboss" (#195). */
  QuorumManager,
  /** @deprecated Import from "agboss" (#195). */
  QuorumRouter,
  /** @deprecated Import from "agboss" (#195). */
  type QuorumRouterMeta,
  /** @deprecated Import from "agboss" (#195). */
  quorumRouterMetaOf,
  /** @deprecated Import from "agboss" (#195). */
  type QuorumRouterOptions,
  /** @deprecated Import from "agboss" (#195). */
  type QuorumStrategy,
} from "../index.js";

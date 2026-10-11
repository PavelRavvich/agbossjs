/**
 * `agboss/channels` — deprecated (#195): the built-in user channels moved to the root entry
 * `agboss`. `agboss migrate imports` rewrites the imports; this entry is removed in the next
 * minor release.
 */
export {
  /** @deprecated Import from "agboss" (#195). */
  AutoApproveChannel,
  /** @deprecated Import from "agboss" (#195). */
  AutoRejectChannel,
  /** @deprecated Import from "agboss" (#195). */
  TerminalUserChannel,
} from "../index.js";

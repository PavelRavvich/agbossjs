/**
 * `agboss/testing/setup` — registers the workflow matchers (`toFollowPath`, `toFinishWith`,
 * …): one line in vitest.config.ts, `setupFiles: ["agboss/testing/setup"]`.
 */
import { expect } from "vitest";
import { workflowMatchers } from "./matchers.js";
import "./vitest-types.js";

expect.extend(workflowMatchers);

import type { WorkflowMatchers } from "./matchers.js";

/** `expect(result).toFollowPath([…])` and the other workflow matchers, typed in every test. */
declare module "vitest" {
  interface Matchers<T> {
    toFollowPath: WorkflowMatchers<T>["toFollowPath"];
    toFinishWith: WorkflowMatchers<T>["toFinishWith"];
    toHavePausedAt: WorkflowMatchers<T>["toHavePausedAt"];
    toFailWith: WorkflowMatchers<T>["toFailWith"];
    toHaveCalledTools: WorkflowMatchers<T>["toHaveCalledTools"];
    toHaveBeenAskedWith: WorkflowMatchers<T>["toHaveBeenAskedWith"];
  }
}

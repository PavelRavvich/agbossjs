import { Workflow, from } from "../../../../src/index.js";
import { TestSettings } from "../../test-flow/star.js";
import { ApiClient, ChatStart, Clerk, Reply, settingsDefaults } from "../app/settings.workflow.js";

/** The same service injecting ENV, but no `environments/` folder next to this file. */
@Workflow({
  name: "no-environment",
  version: "1.0.0",
  flow: [from(ChatStart).next(Clerk), from(Clerk).next(Reply)],
  defaults: settingsDefaults,
  providers: [ApiClient],
})
export class NoEnvironmentApp extends TestSettings {}

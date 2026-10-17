import { Workflow } from "../../../../src/index.js";
import { ApiClient, ChatStart, Clerk, Reply, settingsDefaults } from "../app/settings.workflow.js";
import { start } from "../../../helpers/flow.js";
import { WorkflowStartTextDto } from "../../../../src/dto/index.js";

/** The same service injecting ENV, but no `environments/` folder next to this file. */
@Workflow({
  name: "no-environment-workflow",
  version: "1.0.0",
  flow: [start(ChatStart).returns(WorkflowStartTextDto).toAgent(Clerk).toFinish(Reply)],
  defaults: settingsDefaults,
  providers: [ApiClient],
})
export class NoEnvironmentApp {}

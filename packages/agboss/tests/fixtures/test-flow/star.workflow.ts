import { MODEL_MAX } from "../../../src/config/types.js";
import { Workflow } from "../../../src/flow/decorators/workflow.js";
import { WorkflowSettings } from "../../../src/graph/settings.js";
import { usd } from "../../../src/units/index.js";
import { testPaths } from "./test.flow.js";

/**
 * The star test workflow (tests/fixtures/test-flow): chat → main-router ("test/router", a chat
 * model scripted with `routeTo`) → alpha-agent / beta-agent → the answer. $1 per run, $10 per day.
 */
@Workflow({
  name: "test-bundle-workflow",
  version: "1.0.0",
  flow: testPaths,
  defaults: {
    models: { temperature: 0, maxTokens: MODEL_MAX, cache: true },
    tools: { maxToolCalls: 3 },
    history: { limit: 2 },
  },
})
export class StarWorkflow {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder()
      .limits({ perRun: { cost: usd(1) }, perDay: { cost: usd(10) } })
      .build();
  }
}

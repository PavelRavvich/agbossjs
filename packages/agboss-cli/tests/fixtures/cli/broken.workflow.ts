import { Workflow } from "agboss";
import { WorkflowStartTextDto } from "agboss/dto";
import { TestAnswer, TestChat } from "../../../../agboss/tests/fixtures/test-flow/test.flow.js";
import { agent, start } from "../../../../agboss/tests/helpers/flow.js";
import {
  Coder,
  Researcher,
} from "../../../../agboss/tests/fixtures/test-workflow/test.workflow.js";

/** `agboss check` fixture: the researcher leads nowhere (graph.dead-end), the coder is unreachable. */
@Workflow({
  name: "broken-workflow",
  version: "1.0.0",
  defaults: {
    models: { temperature: 0, cache: true },
    router: { model: "typesafe/jev-1.13" },
    tools: { maxToolCalls: 2 },
    history: { limit: 2 },
  },
  flow: [
    start(TestChat).returns(WorkflowStartTextDto).toAgent(Researcher),
    agent(Coder).toFinish(TestAnswer),
  ],
})
export class BrokenWorkflow {}

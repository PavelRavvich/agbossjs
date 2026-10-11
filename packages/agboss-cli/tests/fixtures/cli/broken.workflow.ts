import { from, Workflow } from "agboss";
import { TestAnswer, TestChat } from "../../../../agboss/tests/fixtures/test-flow/test.flow.js";
import { TestSettings } from "../../../../agboss/tests/fixtures/test-flow/star.js";
import {
  Coder,
  Researcher,
} from "../../../../agboss/tests/fixtures/test-workflow/test.workflow.js";

/** `agboss check` fixture: the researcher leads nowhere (graph.dead-end), the coder is unreachable. */
@Workflow({
  name: "broken-workflow",
  version: "1.0.0",
  defaults: {
    models: { temperature: 0, thinking: "default", cache: true },
    router: { kind: "jev", model: "typesafe/jev-1.13" },
    tools: { maxToolCalls: 2 },
    history: { limit: 2 },
  },
  flow: [from(TestChat).next(Researcher), from(Coder).next(TestAnswer)],
})
export class BrokenWorkflow extends TestSettings {}

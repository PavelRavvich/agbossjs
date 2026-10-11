import { from, type Flow, type FlowNodeClass } from "../../../src/graph/flow.js";
import { Router } from "../../../src/graph/router.decorator.js";
import { WorkflowSettings, type WorkflowDefinition } from "../../../src/graph/settings.js";
import { TestAnswer, TestChat } from "./test.flow.js";

/**
 * A star flow over the given agents (test workflows): chat workflow start → a Jev router "main" → an agent →
 * back to the router → … → replyWith.
 */
export function starOf(...agents: readonly [FlowNodeClass, ...FlowNodeClass[]]): Flow {
  @Router({
    name: "main",
    description: "Sends the message to an agent, or sends the replyWith",
    prompt: "Pick who handles the message.",
    model: "typesafe/jev-1.13",
    maxVisits: 10,
    routes: [
      { prompt: "The replyWith covers the message", target: TestAnswer },
      ...agents.map((agent) => ({ prompt: `${agent.name} work`, target: agent })),
    ],
  })
  class Main {}
  return [from(TestChat).next(Main), from(Main).routes(), from(...agents).next(Main)];
}

/** `settings()` of a test workflow without limits of its own (steps by default). */
export class TestSettings implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder().build();
  }
}

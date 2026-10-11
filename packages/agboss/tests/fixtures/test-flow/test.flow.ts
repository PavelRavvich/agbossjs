import { WorkflowStartText, WorkflowFinishText } from "../../../src/dto/index.js";
import { WorkflowFinish } from "../../../src/graph/workflow-finish.decorator.js";
import { WorkflowStart } from "../../../src/graph/workflow-start.decorator.js";
import { from, type Flow } from "../../../src/graph/flow.js";
import { Router } from "../../../src/graph/router.decorator.js";
import type { LoadedRouter } from "../../../src/graph/router-texts.js";
import { recordNode } from "../../../src/graph/node-kind.js";
import type { Class } from "../../../src/components/injection.js";

/** A bare agent node (the test config holds its settings). */
const agentNode =
  (name: string) =>
  <C extends Class>(value: C): C => {
    recordNode(value, { kind: "agent", name });
    return value;
  };

@WorkflowStart({ name: "chat", description: "A message from the user", input: WorkflowStartText })
export class TestChat {
  declare readonly input: WorkflowStartText;
}

@agentNode("alpha")
export class Alpha {}

@agentNode("beta")
export class Beta {}

@WorkflowFinish({
  name: "replyWith",
  description: "The replyWith to the user",
  output: WorkflowFinishText,
})
export class TestAnswer {}

const ROUTES = {
  alpha: "Handles alpha work",
  beta: "Handles beta work",
  replyWith: "The contributions so far replyWith the task",
} as const;

/** The test workflows' main router: an LLM ("test/router") so tests script it with fake chat models. */
@Router({
  name: "main",
  description: "Sends the task to an agent, or sends the replyWith",
  prompt: "Pick who handles the task.",
  model: "test/router",
  maxVisits: 10,
  routes: [
    { prompt: ROUTES.alpha, target: Alpha },
    { prompt: ROUTES.beta, target: Beta },
    { prompt: ROUTES.replyWith, target: TestAnswer },
  ],
})
export class TestMain {}

/** The star: workflow start → main router → alpha / beta → main again → … → replyWith. */
export const testFlow: Flow = [
  from(TestChat).next(TestMain),
  from(TestMain).routes(),
  from(Alpha, Beta).next(TestMain),
];

/** `TestMain` as assembly loads it (routes sorted by name). */
export const testRouters: readonly LoadedRouter[] = [
  {
    name: "main",
    description: "Sends the task to an agent, or sends the replyWith",
    model: "test/router",
    instructions: async () => "Pick who handles the task.",
    routes: [
      { option: "alpha", condition: async () => ROUTES.alpha },
      { option: "replyWith", condition: async () => ROUTES.replyWith },
      { option: "beta", condition: async () => ROUTES.beta },
    ],
  },
];

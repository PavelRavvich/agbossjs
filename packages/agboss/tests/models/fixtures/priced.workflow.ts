import { file } from "../../../src/components/file.js";

import {
  Agent,
  Workflow,
  MODEL_MAX,
  chain,
  WorkflowFinish,
  WorkflowStart,
  WorkflowSettings,
  type WorkflowDefinition,
} from "../../../src/index.js";
import { WorkflowFinishText, WorkflowStartText } from "../../../src/dto/index.js";
import { DecisionsModelProvider } from "../../../src/models/index.js";
import { usd } from "../../../src/units/index.js";
import { LocalModelProvider, TestOpenRouterProvider } from "../providers.fixture.js";

/** Priced by its provider's table (local/llama), no price of its own. */
@Agent({
  name: "summariser",
  promptUrls: ["./summariser.prompt.md"],
  description: "Summarises the task",
  model: "local/llama",
})
export class Summariser {}

/** Priced by its provider's replyWith (OpenRouter's usage.cost). */
@Agent({
  name: "writer",
  promptUrls: ["./writer.prompt.md"],
  description: "Writes the replyWith",
  model: "moonshotai/kimi-k2.6",
  thinking: "none",
})
export class Writer {}

@WorkflowStart({ name: "task", description: "A task", input: WorkflowStartText })
export class TaskStart {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "replyWith", description: "The replyWith", output: WorkflowFinishText })
export class Answer {}

/** A straight line over two providers: a local server with a price table, and OpenRouter. */
@Workflow({
  name: "priced",
  version: "1.0.0",
  flow: [chain(TaskStart, Summariser, Writer, Answer)],
  defaults: {
    models: { temperature: 0, maxTokens: MODEL_MAX },
    router: { kind: "jev", model: "typesafe/jev-1.13" },
    tools: { maxToolCalls: 2 },
    history: { limit: 2 },
  },
})
export class Priced implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder()
      .limits({ perRun: { cost: usd(0.05) } })
      .modelProviders([TestOpenRouterProvider, DecisionsModelProvider, LocalModelProvider])
      .defaultModelProvider(LocalModelProvider)
      .build();
  }
}

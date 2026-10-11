import {
  Agent,
  InjectionToken,
  Judge,
  provide,
  Workflow,
  chain,
  WorkflowFinish,
  WorkflowSettings,
  WorkflowStart,
  type WorkflowDefinition,
  MODEL_MAX,
} from "../../../src/index.js";
import type { JudgeContext, JudgeHandler, JudgeVerdict } from "../../../src/index.js";
import { WorkflowFinishText, WorkflowStartText } from "../../../src/dto/index.js";
import { DecisionsModelProvider } from "../../../src/models/index.js";
import { LocalModelProvider } from "../../models/providers.fixture.js";

/** What the judge asks its model (a provider value: the judge gets it through its `deps`). */
export const RUBRIC = new InjectionToken<string>("RUBRIC");

/** Asks its own model whether the reply is grounded: `PASS`, or `FAIL: <why>`. */
@Judge({ name: "grounded", model: "local/judge", deps: [RUBRIC] })
export class Grounded implements JudgeHandler {
  constructor(private readonly rubric: string) {}

  async judge(reply: string, ctx: JudgeContext): Promise<JudgeVerdict> {
    const verdict = await ctx.model.invoke(`${this.rubric}\n\nTask: ${ctx.task}\nReply: ${reply}`);
    return verdict.startsWith("PASS")
      ? { passed: true }
      : { passed: false, feedback: verdict.replace(/^FAIL:\s*/u, "") };
  }
}

@Agent({
  name: "writer",
  prompt: "Write.",
  description: "Writes an answer",
  model: "local/llama",
  judges: [Grounded],
  maxRetries: 1,
})
export class Writer {}

@WorkflowStart({ name: "task", description: "A task", input: WorkflowStartText })
export class TaskStart {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "reply", description: "The reply", output: WorkflowFinishText })
export class Reply {}

export const DEFAULTS = {
  models: { temperature: 0, maxTokens: MODEL_MAX },
  router: { kind: "jev", model: "typesafe/jev-1.13" },
  history: { limit: 4 },
} as const;

export const settings = (): WorkflowSettings =>
  WorkflowSettings.builder()
    .modelProviders([DecisionsModelProvider, LocalModelProvider])
    .defaultModelProvider(LocalModelProvider)
    .build();

/** One agent gated by one judge, one retry. */
@Workflow({
  name: "judged-desk",
  version: "1.0.0",
  flow: [chain(TaskStart, Writer, Reply)],
  defaults: DEFAULTS,
  providers: [provide(RUBRIC, "Is the reply grounded in the task? Answer PASS or FAIL: <why>.")],
})
export class JudgedDesk implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return settings();
  }
}

/** A judge with no model: assembly must refuse it. */
@Judge({ name: "modelless", model: "" })
export class Modelless implements JudgeHandler {
  judge(): Promise<JudgeVerdict> {
    return Promise.resolve({ passed: true });
  }
}

@Agent({
  name: "careless",
  prompt: "Write.",
  description: "Gated by a judge without a model",
  model: "local/llama",
  judges: [Modelless],
})
export class Careless {}

@Workflow({
  name: "modelless-desk",
  version: "1.0.0",
  flow: [chain(TaskStart, Careless, Reply)],
  defaults: DEFAULTS,
})
export class ModellessDesk implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return settings();
  }
}

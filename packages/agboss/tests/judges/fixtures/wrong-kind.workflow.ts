import {
  Agent,
  Decision,
  Judge,
  Workflow,
  Router,
  type WorkflowDefinition,
  type WorkflowSettings,
} from "../../../src/index.js";
import type { JudgeContext, JudgeHandler, JudgeVerdict } from "../../../src/index.js";
import { LUNA } from "./decision-judged.workflow.js";
import { Text, WorkflowStartTextDto } from "../../../src/dto/index.js";
import { DecidedBy, WorkflowFinish } from "../../../src/index.js";
import { route, start } from "../../helpers/flow.js";
import { DEFAULTS, Reply, settings, TaskStart } from "./judged.workflow.js";

/** On a chat model, yet asks for a decision. */
@Judge({ name: "chat-decider", model: "local/judge" })
export class ChatDecider implements JudgeHandler {
  async judge(reply: string, ctx: JudgeContext): Promise<JudgeVerdict> {
    const a = await ctx.model.decide({
      state: reply,
      questions: { ok: Decision.noul("The reply is fine") },
    });
    return { passed: a.ok.noul > 0.5 };
  }
}

/** On a decision model, yet chats. */
@Judge({ name: "decision-chatter", model: LUNA })
export class DecisionChatter implements JudgeHandler {
  async judge(reply: string, ctx: JudgeContext): Promise<JudgeVerdict> {
    return { passed: (await ctx.model.invoke(`Is this fine? ${reply}`)) === "yes" };
  }
}

@Agent({
  name: "chat-judged-agent",
  prompt: "Write.",
  description: "Judged by a chat model asked to decide",
  model: "local/llama",
  judges: [ChatDecider],
})
export class ChatJudged {}

@Agent({
  name: "decision-judged-agent",
  prompt: "Write.",
  description: "Judged by a decision model asked to chat",
  model: "local/llama",
  judges: [DecisionChatter],
})
export class DecisionJudged {}

@Workflow({
  name: "chat-decider-desk-workflow",
  version: "1.0.0",
  flow: [start(TaskStart).returns(WorkflowStartTextDto).toAgent(ChatJudged).toFinish(Reply)],
  defaults: DEFAULTS,
})
export class ChatDeciderDesk implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return settings();
  }
}

@Workflow({
  name: "decision-chatter-desk-workflow",
  version: "1.0.0",
  flow: [start(TaskStart).returns(WorkflowStartTextDto).toAgent(DecisionJudged).toFinish(Reply)],
  defaults: DEFAULTS,
})
export class DecisionChatterDesk implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return settings();
  }
}

/** What the intake read the ask as. */
export class AskDto {
  @Text({ prompt: "the ask" })
  text!: string;
}

@Agent({
  name: "intake-agent",
  prompt: "Read.",
  description: "Reads the ask",
  model: "local/llama",
  output: AskDto,
})
export class Intake {}

@Agent({ name: "coder-agent", prompt: "Code.", description: "Writes code", model: "local/llama" })
export class Coder {}

@WorkflowFinish({ name: "as-is-workflow-finish", description: "The ask, as is", output: AskDto })
export class AsIs {}

/** A router on GPT-6 Luna Decisions: a decision model that is not Jev. */
@Router({
  name: "triage-router",
  description: "Sends coding asks to the coder",
  decidedBy: DecidedBy.Model,
  prompt: "Who handles this?",
  model: LUNA,
  input: { ask: AskDto },
  routes: [
    { prompt: "A coding ask", target: Coder },
    { prompt: "Anything else: reply as is", target: AsIs },
  ],
})
export class Triage {}

@Workflow({
  name: "luna-routed-workflow",
  version: "1.0.0",
  flow: [
    start(TaskStart)
      .returns(WorkflowStartTextDto)
      .toAgent(Intake)
      .returns(AskDto)
      .toRouter(Triage)
      .chooseOne(route(Coder).toFinish(Reply), route(AsIs)),
  ],
  defaults: DEFAULTS,
})
export class LunaRouted implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return settings();
  }
}

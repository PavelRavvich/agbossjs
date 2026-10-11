import {
  Agent,
  Decision,
  Judge,
  Workflow,
  chain,
  from,
  Router,
  type WorkflowDefinition,
  type WorkflowSettings,
} from "../../../src/index.js";
import type { JudgeContext, JudgeHandler, JudgeVerdict } from "../../../src/index.js";
import { LUNA } from "./decision-judged.workflow.js";
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
  name: "chat-judged",
  prompt: "Write.",
  description: "Judged by a chat model asked to decide",
  model: "local/llama",
  judges: [ChatDecider],
})
export class ChatJudged {}

@Agent({
  name: "decision-judged",
  prompt: "Write.",
  description: "Judged by a decision model asked to chat",
  model: "local/llama",
  judges: [DecisionChatter],
})
export class DecisionJudged {}

@Workflow({
  name: "chat-decider-desk",
  version: "1.0.0",
  flow: [chain(TaskStart, ChatJudged, Reply)],
  defaults: DEFAULTS,
})
export class ChatDeciderDesk implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return settings();
  }
}

@Workflow({
  name: "decision-chatter-desk",
  version: "1.0.0",
  flow: [chain(TaskStart, DecisionJudged, Reply)],
  defaults: DEFAULTS,
})
export class DecisionChatterDesk implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return settings();
  }
}

@Agent({ name: "intake", prompt: "Read.", description: "Reads the ask", model: "local/llama" })
export class Intake {}

@Agent({ name: "coder", prompt: "Code.", description: "Writes code", model: "local/llama" })
export class Coder {}

/** A router on GPT-6 Luna Decisions: a decision model that is not Jev. */
@Router({
  name: "triage",
  description: "Sends coding asks to the coder",
  prompt: "Who handles this?",
  model: LUNA,
  routes: [
    { prompt: "A coding ask", target: Coder },
    { prompt: "Anything else: reply as is", target: Reply },
  ],
})
export class Triage {}

@Workflow({
  name: "luna-routed",
  version: "1.0.0",
  flow: [chain(TaskStart, Intake, Triage), from(Triage).routes(), from(Coder).next(Reply)],
  defaults: DEFAULTS,
})
export class LunaRouted implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return settings();
  }
}

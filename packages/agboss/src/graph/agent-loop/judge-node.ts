import { HumanMessage, type MessageContent } from "@langchain/core/messages";
import type { JudgeVerdict } from "../../components/judge-decorators.js";
import type { AppState } from "../../core/observability.js";
import type { UsageRecord } from "../../finops/usage.js";
import { AgentFailedError, QualityGateError, type JudgeFeedback } from "../errors.js";
import { extractRunContext } from "../../core/run-context.js";
import type { AsyncNode } from "../types.js";
import type { AgentLoopDeps } from "./deps.js";
import { meteredModel } from "./judge-model.js";
import { loopUsage, type AgentLoopStateType, type AgentLoopUpdate } from "./state.js";

/** The judges that rejected the reply, in the agent's order; every judge runs. */
async function rejectionsOf(
  state: AgentLoopStateType,
  deps: AgentLoopDeps,
  reply: string,
  spent: UsageRecord[],
  threadId: string,
): Promise<JudgeFeedback[]> {
  const agent = deps.agent.name;
  const appState: AppState = { runId: state.runId, threadId, activeNode: agent };
  const rejected: JudgeFeedback[] = [];
  for (const judge of deps.agent.judges ?? []) {
    const ctx = {
      agent,
      runId: state.runId,
      task: state.task,
      attempt: state.retries,
      model: meteredModel(judge, spent),
    };
    const event = { name: judge.name, agentName: agent, state: appState };
    await deps.observer?.onJudgeStart({ ...event, input: reply });
    const verdict: JudgeVerdict = await judge.handler.judge(reply, ctx).catch((error: unknown) => {
      throw new AgentFailedError(agent, [...loopUsage(state), ...spent], error);
    });
    await deps.observer?.onJudgeEnd({ ...event, update: verdict });
    if (!verdict.passed) {
      rejected.push({ judge: judge.name, feedback: verdict.feedback ?? "rejected (no feedback)" });
    }
  }
  return rejected;
}

/** What the agent reads before its retry: every rejecting judge's feedback. */
const retryPrompt = (rejected: readonly JudgeFeedback[]): string =>
  [
    "Your reply did not pass the quality gate. Fix the following and reply again:",
    ...rejected.map((r) => `- [${r.judge}] ${r.feedback}`),
  ].join("\n");

/** The reply as the flow's contribution (the move the replyWith node appended). */
function replyContent(state: AgentLoopStateType, reply: string): MessageContent {
  const content = state.messages.at(-1)?.content;
  return typeof content === "string" || content === undefined ? reply : content;
}

/**
 * The quality gate after the agent's reply: every `@Judge` of the agent judges it with its own model
 * (spend recorded as `judge:<name>`). All pass → the reply is the agent's contribution. A rejection
 * sends the feedback back to the model for a retry; after `maxRetries` retries → `QualityGateError`.
 */
export function makeJudgeNode(deps: AgentLoopDeps): AsyncNode<AgentLoopStateType, AgentLoopUpdate> {
  const { name: agent, judges = [], maxRetries = 0 } = deps.agent;
  return async (state, config) => {
    if (judges.length === 0 || state.reply === null) return {};
    const spent: UsageRecord[] = [];
    const rejected = await rejectionsOf(
      state,
      deps,
      state.reply,
      spent,
      extractRunContext(config, state.runId).threadId,
    );
    if (rejected.length === 0) {
      return {
        usage: spent,
        contributions: [{ agent, content: replyContent(state, state.reply) }],
      };
    }
    if (state.retries >= maxRetries) {
      throw new QualityGateError(agent, [...loopUsage(state), ...spent], rejected, state.retries);
    }
    return {
      reply: null,
      retries: 1,
      usage: spent,
      messages: [new HumanMessage(retryPrompt(rejected))],
    };
  };
}

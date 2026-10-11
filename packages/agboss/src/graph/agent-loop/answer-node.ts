import type { AsyncNode } from "../types.js";
import type { AgentLoopDeps } from "./deps.js";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { JudgeOwner, JudgePoint, visitAgentAnswer, mergePolicies } from "./judge-points.js";
import type { AgentLoopStateType, AgentLoopUpdate } from "./state.js";
import { extractRunContext } from "../../core/run-context.js";

/** A move without tool calls is the agent's replyWith: `beforeAgentAnswer`, then it leaves the loop. */
export function makeAnswerNode(
  deps: AgentLoopDeps,
): AsyncNode<AgentLoopStateType, AgentLoopUpdate> {
  const agent = deps.agent.name;
  // eslint-disable-next-line complexity
  return async (state, config) => {
    const combinedGuardrails = mergePolicies(deps.workflowGuardrails, deps.guardrails);
    const runCtx = extractRunContext(config, state.runId);
    const ctx = {
      agent,
      replyWith:
        typeof state.move?.content === "string" ? state.move.content : (state.move?.text ?? ""),
      runId: runCtx.runId,
      metadata: runCtx.metadata,
    };
    const appState = { runId: state.runId, threadId: runCtx.threadId, activeNode: deps.agent.name };
    await visitAgentAnswer(combinedGuardrails, ctx, deps.observer, appState);
    const content = state.move?.content ?? "";
    const isString = typeof content === "string";
    const textReply = isString ? content.trim() : (state.move?.text.trim() ?? "");
    const trimmedContent = isString ? content.trim() : content;
    // with judges, the reply becomes the agent's contribution only once they pass it (judge node)
    const judged = (deps.agent.judges ?? []).length > 0;
    return {
      messages: state.move === null ? [] : [state.move],
      move: null,
      reply: textReply,
      contributions: judged ? [] : [{ agent, content: trimmedContent }],
    };
  };
}

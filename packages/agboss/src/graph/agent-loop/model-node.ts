// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { QuorumCancelledError, type BranchCancelToken } from "../../concurrency/quorum-manager.js";
import { AIMessage, SystemMessage, type AIMessageChunk } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { recordUsage, totalCost } from "../../finops/usage.js";
import { BUDGET_STOP_MESSAGE } from "../../prompts/agents.js";
import { toolDefinitionOf } from "../../tools/index.js";
import { AgentFailedError } from "../errors.js";
import type { AsyncNode } from "../types.js";
import { callsOf, type AgentLoopDeps } from "./deps.js";
import { agentLimitError } from "./limits.js";
import { loopUsage, type AgentLoopStateType, type AgentLoopUpdate } from "./state.js";
import { normalisePromptText } from "../text.js";
import { extractRunContext, throwIfCancelled } from "../../core/run-context.js";

export class ToolCallingUnsupportedError extends Error {
  override name = "ToolCallingUnsupportedError";
}

/**
 * The run's budget. An unlimited one (`Infinity`) does not survive a checkpoint — JSON keeps it as
 * `null` — so anything that is not a finite amount reads as unlimited.
 */
const budgetOf = (state: AgentLoopStateType, deps: AgentLoopDeps): number =>
  Math.min(
    deps.runBudgetCap,
    Number.isFinite(state.budgetUsd) ? state.budgetUsd : Number.POSITIVE_INFINITY,
  );

const isBudgetSpent = (state: AgentLoopStateType, deps: AgentLoopDeps): boolean =>
  totalCost(state.usage) >= budgetOf(state, deps);

/** One model turn: the agent's system prompt and conversation, its tools bound. */
async function callModel(
  state: AgentLoopStateType,
  deps: AgentLoopDeps,
  config: RunnableConfig | undefined,
): Promise<AIMessageChunk> {
  const { binding, instructions, tools, name } = deps.agent;

  let systemPrompt = typeof instructions === "function" ? await instructions(state) : instructions;
  systemPrompt = normalisePromptText(systemPrompt);

  // cache markers, where the model needs them, are placed by its provider on the wire (#151)
  const messages = [new SystemMessage(systemPrompt), ...state.messages];
  if (tools.length === 0) return binding.model.invoke(messages, config);
  if (binding.model.bindTools === undefined) {
    throw new ToolCallingUnsupportedError(`The model of agent "${name}" cannot call tools`);
  }
  return binding.model.bindTools(tools.map(toolDefinitionOf)).invoke(messages, config);
}

/**
 * The move with an id on every tool call: results are stored by it and it is the tool's idempotency
 * key, so a call the model gave no id gets one unique within the run (run, visit, turn, position).
 */
function withCallIds(response: AIMessageChunk, state: AgentLoopStateType): AIMessage {
  const turn = state.modelCalls + 1;
  const toolCalls = (response.tool_calls ?? []).map((call, index) => ({
    ...call,
    id:
      call.id === undefined || call.id === ""
        ? `${state.runId}:${String(state.flowPath.length)}:${String(turn)}:${String(index)}`
        : call.id,
  }));
  return new AIMessage({ content: response.content, tool_calls: toolCalls });
}

/**
 * One model call = one node. Before it: the run budget (spent → the loop ends without a call, the
 * flow then fails at its cost limit) and `modelCalls`; after it: the usage record and `toolCalls`
 * for the calls the move asks for. A failed call fails the agent with the loop's spend.
 */
// eslint-disable-next-line max-lines-per-function
export function makeModelNode(deps: AgentLoopDeps): AsyncNode<AgentLoopStateType, AgentLoopUpdate> {
  const { name, limits, binding } = deps.agent;
  // eslint-disable-next-line max-lines-per-function
  return async (state, config) => {
    const runCtx = extractRunContext(config, state.runId);
    if (runCtx.branchCancelToken?.cancelled) {
      throw new QuorumCancelledError();
    }
    throwIfCancelled(runCtx.run);
    if (isBudgetSpent(state, deps)) {
      return {
        reply: BUDGET_STOP_MESSAGE,
        contributions: [{ agent: name, content: BUDGET_STOP_MESSAGE }],
      };
    }
    const turn = state.modelCalls + 1;
    if (turn > limits.modelCalls) {
      const breach = {
        agent: name,
        limit: "modelCalls",
        max: limits.modelCalls,
        actual: turn,
        spent: [],
      } as const;
      throw agentLimitError(state, breach);
    }
    const appState = {
      runId: state.runId,
      threadId: runCtx.threadId,
      activeNode: name,
      variables: {},
      history: state.messages,
    }; // AppState stub
    await deps.observer?.onModelStart({
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      modelName: binding.settings.model ?? "unknown",
      callerName: name,
      rawPayload: state.messages,
      state: appState,
    });
    const response = await callModel(state, deps, config).catch((error: unknown) => {
      throw new AgentFailedError(name, loopUsage(state), error);
    });
    const usageRecord = recordUsage(name, binding.settings, response);
    const spent = [usageRecord];
    await deps.observer?.onModelEnd({
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      model: binding.settings.model ?? "unknown",
      callerName: name,
      rawContent: response.content,
      usage: {
        promptTokens: usageRecord.inputTokens,
        completionTokens: usageRecord.outputTokens,
        totalTokens: usageRecord.inputTokens + usageRecord.outputTokens,
      },
      calculatedCost: usageRecord.costUsd,
      state: appState,
    });
    const move = withCallIds(response, state);
    const toolCalls = state.toolCalls + callsOf(move).length;
    if (toolCalls > limits.toolCalls) {
      const breach = {
        agent: name,
        limit: "toolCalls",
        max: limits.toolCalls,
        actual: toolCalls,
        spent,
      } as const;
      throw agentLimitError(state, breach);
    }
    return { move, usage: spent, modelCalls: 1, toolCalls: callsOf(move).length };
  };
}

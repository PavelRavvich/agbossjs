import type { RunnableConfig } from "@langchain/core/runnables";
import { recordReportedCost, type UsageRecord } from "../../finops/usage.js";
import { renderToolResult, type AnyTool, type ToolCallContext } from "../../tools/index.js";
import { toolNamed, type AgentLoopDeps } from "./deps.js";
import type { AgentLoopUpdate, ToolTask } from "./state.js";
import { inToolCallFrame } from "../../flow/context/frame.js";
import { extractRunContext, throwIfCancelled, type RunContext } from "../../core/run-context.js";
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The run's signal (cancel included) combined with the tool's own timeout. */
const signalFor = (
  tool: AnyTool,
  config: RunnableConfig | undefined,
  run: RunContext,
): AbortSignal => {
  const signals = [run.signal, AbortSignal.timeout(tool.timeoutMs)];
  return AbortSignal.any(config?.signal === undefined ? signals : [...signals, config.signal]);
};

/** Tool failures are recoverable: whatever went wrong, the model reads it as `Tool error: …`. */
async function runTool(tool: AnyTool, args: unknown, context: ToolCallContext): Promise<string> {
  try {
    return renderToolResult(await tool.invoke(args, context));
  } catch (error) {
    if (error && typeof error === "object" && "name" in error && error.name === "GraphInterrupt") {
      throw error;
    }
    return renderToolResult({ kind: "error", message: errorMessage(error) });
  }
}

/**
 * One tool call = one task (`Send`): its result is stored under its call id as soon as it finishes,
 * so a crash later never repeats it. A call running when the process died runs again with the same
 * `callId` — part of its idempotency key (`executionContext.step.idempotencyKey`). The call runs in
 * its own frame; reported costs and the model spend of `ROUTER_FACTORY` routers land in the loop's
 * usage as the tool's.
 */
export function makeToolNode(
  deps: AgentLoopDeps,
): (task: ToolTask, config?: RunnableConfig) => Promise<AgentLoopUpdate> {
  return async (task, config) => {
    const tool = toolNamed(deps.agent, task.tool);
    const runCtx = extractRunContext(config, task.runId);
    if (tool === undefined) return {};
    const appState = {
      runId: runCtx.runId,
      threadId: runCtx.threadId,
      activeNode: deps.agent.name,
      variables: {},
      history: [],
    };
    throwIfCancelled(runCtx.run);
    const usage: UsageRecord[] = [];
    const caller = tool.costCaller ?? `tool:${tool.name}`;
    const context: ToolCallContext = {
      signal: signalFor(tool, config, runCtx.run),
      reportCost: (usd) => {
        usage.push(recordReportedCost(tool, usd));
      },
    };
    const reportUsage = (spent: UsageRecord): void => {
      usage.push({ ...spent, caller });
    };
    const event = { toolName: task.tool, agentName: deps.agent.name, state: appState };
    await deps.observer?.onToolStart({ ...event, arguments: task.args });
    const content = await inToolCallFrame(task.callId, { reportUsage }, () =>
      runTool(tool, task.args, context),
    );
    await deps.observer?.onToolEnd({ ...event, update: content });
    return { results: { [task.callId]: { callId: task.callId, tool: task.tool, content } }, usage };
  };
}

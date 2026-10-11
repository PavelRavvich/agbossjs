import { interrupt } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import { recordReportedCost, type UsageRecord } from "../../finops/usage.js";
import { renderToolResult, type AnyTool, type ToolContext } from "../../tools/index.js";
import { toolNamed, type AgentLoopDeps } from "./deps.js";
import type { AgentLoopUpdate, ToolTask } from "./state.js";
import type { PendingPause } from "../../pause/index.js";
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
async function runTool(tool: AnyTool, args: unknown, context: ToolContext): Promise<string> {
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
 * `callId` — the tool's idempotency key. Reported costs land in the loop's usage.
 */
// eslint-disable-next-line max-lines-per-function
export function makeToolNode(
  deps: AgentLoopDeps,
): (task: ToolTask, config?: RunnableConfig) => Promise<AgentLoopUpdate> {
  // eslint-disable-next-line max-lines-per-function
  return async (task, config) => {
    const tool = toolNamed(deps.agent, task.tool);
    const runCtx = extractRunContext(config, task.runId);
    const appState = {
      runId: runCtx.runId,
      threadId: runCtx.threadId,
      activeNode: deps.agent.name,
      variables: {},
      history: [],
    }; // AppState stub
    if (tool === undefined) {
      return {};
    }
    throwIfCancelled(runCtx.run);
    const usage: UsageRecord[] = [];
    const context: ToolContext = {
      executionContext: runCtx.executionContext,
      run: runCtx.run,
      runId: task.runId,
      workflow: deps.bundle,
      agent: deps.agent.name,
      callId: task.callId,
      signal: signalFor(tool, config, runCtx.run),
      reportCost: (usd) => {
        usage.push(recordReportedCost(tool, usd));
      },
      pause: (ask: unknown): unknown => {
        const pending: PendingPause = {
          kind: "interactive",
          agent: deps.agent.name,
          tool: tool.name,
          callId: task.callId,
          args: task.args,
          payload: ask,
        };
        return interrupt(pending);
      },
    };
    await deps.observer?.onToolStart({
      toolName: task.tool,
      agentName: deps.agent.name,
      arguments: task.args,
      state: appState,
    });
    const content = await runTool(tool, task.args, context);
    await deps.observer?.onToolEnd({
      toolName: task.tool,
      agentName: deps.agent.name,
      update: content,
      state: appState,
    });
    return { results: { [task.callId]: { callId: task.callId, tool: task.tool, content } }, usage };
  };
}

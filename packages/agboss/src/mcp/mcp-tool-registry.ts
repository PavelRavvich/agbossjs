import { randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { App, ExecutionOutput } from "../app/types.js";
import type { ToolHandler } from "../components/decorators.js";
import type { Class } from "../components/injection.js";
import { componentOf, type ToolMeta } from "../components/metadata.js";
import { adapt } from "../components/runtime.js";
import { validate } from "../dto/schema.js";
import { nodeInfoOf } from "../graph/node-kind.js";
import { workflowStartMetaOf, type WorkflowStartClass } from "../graph/workflow-start.decorator.js";
import { renderToolResult, type ToolContext, type ToolOutput } from "../tools/index.js";
import { newRunContext } from "../core/run-context.js";
import {
  RESUME_TOOL,
  guarded,
  isRecord,
  objectSchema,
  parseDecision,
  type McpCall,
  type ToolRegistry,
} from "./mcp-service-helpers.js";

/**
 * What an `@McpExpose` exposes: its `@Tool` / `@McpTool` exports (run through the same adapter as
 * agent tool calls — DTO validation of input and output, timeout, `callId`), its workflow starts
 * (`app.execute`), and `resume_workflow` (`app.resume`) when there is a start.
 */
export function collectTools(app: App, exports: readonly Class[], context: unknown): ToolRegistry {
  const registry: ToolRegistry = { tools: [], handlers: new Map() };
  let hasWorkflows = false;
  for (const exp of exports) {
    const meta = toolMetaOf(exp);
    if (meta) {
      addTool(registry, { app, exp, meta, context });
    } else if (isStart(exp)) {
      hasWorkflows = true;
      addWorkflowStart(registry, app, exp, context);
    }
  }
  if (hasWorkflows) addResumeTool(registry, app, context);
  return registry;
}

function toolMetaOf(exp: Class): ToolMeta | undefined {
  const component = componentOf(exp);
  return component?.kind === "tool" || component?.kind === "mcp-tool" ? component.meta : undefined;
}

const isToolHandler = (value: unknown): value is ToolHandler<unknown, unknown> =>
  isRecord(value) && typeof value.run === "function";

interface ExportedTool {
  readonly app: App;
  readonly exp: Class;
  readonly meta: ToolMeta;
  readonly context: unknown;
}

function addTool(registry: ToolRegistry, exported: ExportedTool): void {
  const { app, exp, meta } = exported;
  const instance: unknown = app.hasTool(meta.name) ? app.resolve(exp) : undefined;
  if (!isToolHandler(instance)) {
    throw new Error(
      `@McpExpose exports ${exp.name}, which is not a tool of workflow "${app.name}"`,
    );
  }
  const tool = adapt(instance, meta);
  registry.tools.push({
    name: meta.name,
    description: meta.description || (meta.prompt ?? ""),
    inputSchema: objectSchema(meta.input),
    outputSchema: objectSchema(meta.output),
  });
  registry.handlers.set(meta.name, async (call) =>
    toolResult(await tool.invoke(call.args, toolContext(exported, call))),
  );
}

/** What the tool may know about this call: there is no agent run, so it cannot pause. */
const toolContext = ({ app, meta, context }: ExportedTool, call: McpCall): ToolContext => {
  const runId = `mcp_${randomUUID()}`;
  return {
    executionContext: context,
    run: newRunContext({ runId, signal: call.signal }),
    runId,
    workflow: app.name,
    agent: "mcp",
    callId: call.callId ?? `mcp_${meta.name}_${randomUUID()}`,
    signal: call.signal,
    reportCost: () => undefined,
    pause: () => {
      throw new Error(`${meta.name} cannot pause when called over MCP`);
    },
  };
};

const toolResult = (output: ToolOutput<unknown>): CallToolResult =>
  output.kind === "ok" && isRecord(output.value)
    ? {
        content: [{ type: "text", text: renderToolResult(output) }],
        structuredContent: output.value,
      }
    : {
        content: [{ type: "text", text: renderToolResult(output) }],
        isError: output.kind === "error",
      };

/** An exported `@WorkflowStart` class (its options are recorded by the decorator). */
const isStart = (exp: Class): exp is WorkflowStartClass =>
  nodeInfoOf(exp)?.kind === "workflow-start";

function addWorkflowStart(
  registry: ToolRegistry,
  app: App,
  exp: WorkflowStartClass,
  context: unknown,
): void {
  const startMeta = workflowStartMetaOf(exp);
  if (!startMeta) return;
  registry.tools.push({
    name: startMeta.name,
    description: startMeta.description || `Run workflow starting at ${startMeta.name}`,
    inputSchema: objectSchema(startMeta.input),
  });
  registry.handlers.set(startMeta.name, (call) =>
    guarded(async () => {
      const input = validate(startMeta.input, call.args);
      const options = { executionContext: context, signal: call.signal };
      return formatWorkflowOutput(await app.execute(exp, input, options));
    }),
  );
}

function addResumeTool(registry: ToolRegistry, app: App, context: unknown): void {
  registry.tools.push(RESUME_TOOL);
  registry.handlers.set(RESUME_TOOL.name, (call) =>
    guarded(async () => {
      const input = isRecord(call.args) ? call.args : {};
      if (typeof input.threadId !== "string") throw new Error("threadId must be a string");
      const options = { executionContext: context, signal: call.signal };
      const result = await app.resume(input.threadId, parseDecision(input.decision), options);
      return formatWorkflowOutput(result);
    }),
  );
}

function formatWorkflowOutput(result: ExecutionOutput): unknown {
  if (result.status === "paused") {
    return {
      status: "paused",
      threadId: result.thread,
      message: "Workflow paused, requires resume.",
      pauseDetails: result.pause,
    };
  }
  if (result.output) return result.output;
  if (result.finishes) return result.finishes;
  return result;
}

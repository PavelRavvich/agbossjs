import type { ToolDefinition } from "@langchain/core/language_models/base";
import { inputJsonSchema } from "../dto/schema.js";
import type { AnyTool, ToolOutput } from "./types.js";

/** What the model reads back: JSON of the value, or a readable error. */
export function renderToolResult(result: ToolOutput<unknown>): string {
  if (result.kind === "error") return `Tool error: ${result.message}`;
  return typeof result.value === "string" ? result.value : JSON.stringify(result.value);
}

/**
 * A tool as the model sees it (bound to the agent's chat model): name, description and the JSON
 * Schema of its input. Running it — validation, timeouts, errors as results — stays in `tool.invoke`.
 */
export function toolDefinitionOf(tool: AnyTool): ToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: inputJsonSchema(tool.input),
    },
  };
}

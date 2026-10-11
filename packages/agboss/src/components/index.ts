/** Angular-style components: annotated classes wired by a `@Workflow` module (Wiki → Components). */
export { workflowOf } from "./assemble.js";
export { ENV, ROUTER_FACTORY, toolOf } from "./runtime.js";
export {
  Agent,
  Workflow,
  Injectable,
  McpServer,
  McpTool,
  Rag,
  Tool,
  type ToolHandler,
} from "./decorators.js";
export { InjectionToken, type Class, type Provider, type Scope, type Token } from "./injection.js";
export { ComponentError, componentOf } from "./metadata.js";
export { PromptError, type PromptProblem, type PromptProblemCode } from "./prompt-problems.js";
export type { OnStart, OnStop } from "./lifecycle.js";
export type { AgentMeta, WorkflowMeta, RagBinding } from "./meta-types.js";
export {
  McpServerClient,
  mcpServerStub,
  type ServerTool,
  type ServerTools,
  type ToolsOf,
} from "./mcp-client.js";
export { file } from "./file.js";

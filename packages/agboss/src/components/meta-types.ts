import type { AgentsConfig } from "../config/types.js";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { AnyTool } from "../tools/index.js";
import type { RagMode } from "../rag/types.js";
import type { Flow, FlowNodeClass } from "../graph/flow.js";
import type { Guardrail, PiiPolicy } from "./policy-decorators.js";
import type { JudgeHandler } from "./judge-decorators.js";
import type { ToolHandlerClass } from "./decorators.js";
import type { BaseMemoryStrategy } from "../memory/types.js";
import type { Class, Provider } from "./injection.js";
import type { ObserverClass } from "../core/observer-hooks.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { PromptOptions } from "./prompt-options.js";

type AgentSettings = AgentsConfig["agents"][string];

/** An agent's use of a `@Rag` knowledge base; both fields required (no defaults). */
export interface RagBinding {
  readonly use: Class;
  readonly mode: RagMode;
}

/** The policy settings an agent or a tool may declare (`@Agent`, `@Tool`). */
export interface PolicyFields {
  readonly piiPolicies?: readonly Class<PiiPolicy>[];
  readonly guardrails?: readonly Class<Guardrail>[];
  readonly overridePiiPolicies?: readonly Class<PiiPolicy>[];
  readonly disablePiiPolicies?: readonly Class<PiiPolicy>[];
  readonly overrideGuardrails?: readonly Class<Guardrail>[];
  readonly disableGuardrails?: readonly Class<Guardrail>[];
}

/** `@Agent` — settings of one agent; tools are class references. */
export interface AgentMeta extends PolicyFields {
  readonly name: string;
  /** The compensating agent class for SAGA rollbacks */
  readonly compensate?: FlowNodeClass;
  readonly description: string;
  readonly prompt?: string;
  readonly promptUrls?: readonly string[];
  readonly model: string;
  /**
   * This agent's memory strategy (a `BaseMemoryStrategy` subclass from `agboss/memory`,
   * created by the workflow's container); other agents use the built-in one (`defaults.history`,
   * `compaction`).
   */
  readonly memoryStrategy?: Class<BaseMemoryStrategy>;
  /** Overrides the model provider's price table; the provider's own reported cost comes first. */
  readonly price?: AgentSettings["price"];
  readonly thinking?: AgentSettings["thinking"];
  readonly temperature?: number;
  readonly maxTokens?: AgentSettings["maxTokens"];
  /** `{{key}}` in agent prompts is replaced with the value (assembly fails on unknown keys). */
  readonly promptVariables?: Readonly<Record<string, string>>;
  readonly cache?: boolean;
  readonly historyLimit?: number;
  readonly historySummaries?: number;
  /** Tool calls per call of the agent (`agents.<name>.limits.toolCalls`); default 20. */
  readonly maxToolCalls?: number;
  /** `@Tool` or `@McpTool` classes. */
  readonly tools?: readonly ToolHandlerClass[];
  /** `@Judge` classes. */
  readonly judges?: readonly Class<JudgeHandler>[];
  readonly maxRetries?: number;
  /** Knowledge bases: `{ use: CompanyDocs, mode: "tool" | "context" }` — `mode` is required. */
  readonly rag?: readonly RagBinding[];
  /** Set by `@Agent` itself: the file the agent is declared in. */
  readonly source?: string;
}

/**
 * `@Workflow` — the module: its graph (`flow`; the agents are the flow's agent nodes), workflow
 * settings, MCP servers and providers for DI. Limits come from the class's `settings()`.
 */

/** `@WorkflowAction` — a programmatic node without LLM. */
export interface WorkflowActionMeta {
  readonly name: string;
  readonly compensate?: FlowNodeClass;
  readonly description?: string;
  readonly inboundAdapter?: Class;
}

export interface WorkflowMeta {
  readonly name: string;
  readonly version: string;
  /** The workflow's graph: transitions between its nodes (Wiki → Workflow). */
  readonly flow: Flow;
  readonly defaults: AgentsConfig["defaults"];
  readonly guards?: AgentsConfig["guards"];
  readonly piiPolicies?: readonly Class<PiiPolicy>[];
  readonly guardrails?: readonly Class<Guardrail>[];
  /**
   * Conversation compaction: the built-in memory strategy summarises every `every` turns with
   * `model` and agents see the latest `keep` summaries (off when absent: a sliding window only).
   */
  readonly compaction?: AgentsConfig["compaction"];
  readonly mcp?: readonly Class[];
  readonly providers?: readonly Provider[];
  readonly compactionPrompt?: string;
  readonly promptVariables?: Readonly<Record<string, string>>;
  readonly channelClasses?: readonly Class[];
  /** Observer classes (`implements OnToolEnd, …`), created by the container; only these get hooks. */
  readonly observers?: readonly ObserverClass[];
}

/** `@Channel` — settings of a channel. */
export interface ChannelMeta {
  readonly name: string;
  readonly description?: string;
  readonly inboundAdapter?: Class;
}

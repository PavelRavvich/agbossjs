import type { ObserverManager } from "../../core/observer-manager.js";
import type { AIMessage } from "@langchain/core/messages";
import type { JudgeBinding, ModelBinding } from "../../llm/registry.js";
import type { BaseMemoryStrategy } from "../../memory/types.js";
import type { KnowledgeSource } from "../../rag/types.js";
import type { AnyTool } from "../../tools/index.js";
import type { ToolCallApproval } from "./approval.js";
import type { JudgePoints } from "./judge-points.js";
import type { AgentLoopLimits } from "./limits.js";
import type { PromptInput } from "../../components/prompt-input.js";
import type { JudgeHandler } from "../../components/judge-decorators.js";

/** Everything needed to run one configured agent. */
export interface AgentDefinition {
  readonly name: string;
  readonly binding: ModelBinding;
  readonly instructions: PromptInput;
  readonly tools: readonly AnyTool[];
  readonly limits: AgentLoopLimits;
  readonly historyLimit: number;
  readonly summariesLimit: number;
  /** What of the thread memory the agent sees; absent = the built-in sliding window. */
  readonly memory?: BaseMemoryStrategy;
  /** Context-mode knowledge bases: retrieved before the first model call. */
  readonly knowledge: readonly KnowledgeSource[];
  /** Quality gates of the reply (`@Agent({ judges })`), each with its own model; none = no gate. */
  readonly judges?: readonly AgentJudge[];
  /** How often a reply the judges rejected is retried before `QualityGateError`; default 0. */
  readonly maxRetries?: number;
}

/** One `@Judge` of an agent: its name, its instance (from the container) and its model (chat or decisions). */
export interface AgentJudge {
  readonly name: string;
  readonly handler: JudgeHandler;
  readonly binding: JudgeBinding;
}

/** What an agent's loop is built from. */
export interface AgentLoopDeps {
  readonly agent: AgentDefinition;
  readonly bundle: string;
  readonly runBudgetCap: number;
  /** Set only with a pause seam: which calls wait for a decision, and how it is asked. */
  readonly approval?: ToolCallApproval | undefined;
  readonly judges: JudgePoints;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly piiPolicies?: { override: boolean; instances: readonly any[]; disable: readonly any[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly guardrails?: { override: boolean; instances: readonly any[]; disable: readonly any[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly workflowPiiPolicies?: readonly any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly workflowGuardrails?: readonly any[];
  readonly toolPiiPolicies?: (tool: string) => {
    override: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    instances: readonly any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    disable: readonly any[];
  };
  readonly toolGuardrails?: (tool: string) => {
    override: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    instances: readonly any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    disable: readonly any[];
  };
  readonly observer?: ObserverManager;
}

/** One tool call of a move, with its id (assigned by the loop when the model gives none). */
export interface ToolCallRequest {
  readonly callId: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
}

/** The tool calls of a move, in the model's order. */
export const callsOf = (move: AIMessage | null): ToolCallRequest[] =>
  (move?.tool_calls ?? []).map((call) => ({
    callId: call.id ?? "",
    tool: call.name,
    args: call.args,
  }));

export const toolNamed = (agent: AgentDefinition, name: string): AnyTool | undefined =>
  agent.tools.find((tool) => tool.name === name);

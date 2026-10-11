import type { ObserverManager } from "../core/observer-manager.js";
import type { AgentPrompts, AgentsConfigOf } from "../config/types.js";
import type { GuardSet } from "../guards/index.js";
import type { ModelRegistry } from "../llm/registry.js";
import type { BaseMemoryStrategy } from "../memory/types.js";
import type { PauseSeam } from "../pause/index.js";
import type { KnowledgeSource } from "../rag/types.js";
import type { RouterEngine } from "../routers/index.js";
import type { AnyTool } from "../tools/index.js";
import type { Flow } from "./flow.js";
import type { LoadedRouter } from "./router-texts.js";
import type {
  IWorkflowAction,
  ChannelRequest,
  InboundChannelAdapter,
} from "../components/decorators.js";
import type { WorkflowLimits } from "./settings.js";
import type { JudgeHandler } from "../components/judge-decorators.js";

/** What the workflow's graph is built from: its flow, its agents and the existing nodes' parts. */
export interface GraphDeps<TName extends string> {
  readonly config: AgentsConfigOf<TName>;
  readonly registry: ModelRegistry;
  readonly prompts: AgentPrompts<TName>;
  /** Resolves a tool name from an agent's config to the tool. */
  readonly tools: (name: string) => AnyTool;
  readonly guards: GuardSet;
  /** Resolves an action name to the instantiated WorkflowAction */
  readonly actions?: (name: string) => IWorkflowAction;
  /** Agents' own memory strategies (`@Agent({ memoryStrategy })`); the rest use the built-in one. */
  readonly memory?: ReadonlyMap<string, BaseMemoryStrategy>;
  /** The agents' `@Judge`s by judge name, created by the container (models in `registry.judges`). */
  readonly judges?: ReadonlyMap<string, JudgeHandler>;
  /** Context-mode knowledge bases per agent (knowledge bases, #88). */
  readonly knowledge?: (agent: string) => readonly KnowledgeSource[];
  /** Optional pause seam (approval of tool calls). Off by default. */
  readonly pause?: PauseSeam | undefined;
  /** Dispatches an approval request to the specified channel. */
  readonly requestApproval?: (channelName: string, req: ChannelRequest) => Promise<void>;
  readonly piiPolicies?: (agent: string) => {
    override: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    instances: readonly any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    disable: readonly any[];
  };
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly workflowPiiPolicies?: readonly any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly workflowGuardrails?: readonly any[];
  readonly guardrails?: (agent: string) => {
    override: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    instances: readonly any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    disable: readonly any[];
  };
  /** The inbound adapter of a channel: reads the reply a run is resumed with. */
  readonly channelAdapters?: (channel: string) => InboundChannelAdapter | undefined;
  /** The workflow's graph: its transitions (`@Workflow({ flow })`). */
  readonly flow: Flow;
  /** From the workflow's `settings()`. */
  readonly limits: WorkflowLimits;
  /** Every router of the flow with its texts loaded (part of the run's versions). */
  readonly routers: readonly LoadedRouter[];
  /** The routing strategy of a router: its own model (Jev or a chat model). */
  readonly routerFor: (router: LoadedRouter) => RouterEngine;
  readonly observer?: ObserverManager;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters, @typescript-eslint/no-explicit-any
  readonly container?: { get: <T>(token: any) => T };
  /** The quorum strategy of a router by name; undefined when no provider declares it. */
  readonly quorumRouters?: (
    name: string,
  ) => import("../concurrency/quorum.decorator.js").QuorumStrategy | undefined;
  /** A batch strategy by name; undefined when no provider declares it. */
  readonly batchStrategies?: (
    key: import("../components/injection.js").Class | string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => import("../concurrency/batch.decorator.js").BatchParallelStrategy<any, any> | undefined;
}

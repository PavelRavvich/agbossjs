/**
 * The agent loop on its own (#150): a scripted model picked by the conversation, tools that log
 * what they did, and helpers to start, pause, resume and read the loop. Imports `src` only, so the
 * kill-and-resume child process (`loop-process.ts`) can load it too.
 */
import { ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { Command, MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import {
  agentLoopGraph,
  loopInputOf,
  noJudges,
  pauseSeamApproval,
  type AgentLoopGraph,
  type AgentLoopLimits,
  type AgentLoopStateType,
  type AgentLoopUpdate,
  type JudgePoints,
} from "../../../src/graph/agent-loop/index.js";
import type { FlowStateType } from "../../../src/graph/flow-state.js";
import { resolveSettings } from "../../../src/llm/registry.js";

import type { AnyTool } from "../../../src/tools/index.js";
import { ConversationModel, repoTools, type ScriptedMove } from "./scripted.js";

export * from "./scripted.js";
import type { ToolCallApprovalDecision } from "../../../src/dto/standard/framework.js";

export interface HarnessOptions {
  readonly moves: readonly ScriptedMove[];
  /** The pause seam's approval (default on: write tools wait for a decision). */
  readonly approval?: boolean;
  readonly limits?: Partial<AgentLoopLimits>;
  readonly guardrails?: any[];
  readonly tools?: (log: (effect: string) => void) => AnyTool[];
  readonly runBudgetCap?: number;
  readonly log?: (effect: string) => void;
  readonly onModelCall?: (move: number) => void;
}

/** A loop graph and what it did: the tools' effects, the model's calls (by move), the model. */
export interface Harness {
  readonly graph: AgentLoopGraph;
  readonly effects: string[];
  readonly modelCalls: number[];
  readonly model: ConversationModel;
}

export const AGENT = "coder";

export function harness(
  options: HarnessOptions,
  checkpointer: BaseCheckpointSaver = new MemorySaver(),
): Harness {
  const effects: string[] = [];
  const modelCalls: number[] = [];
  const log = options.log ?? ((effect: string) => effects.push(effect));
  const model = new ConversationModel(
    options.moves,
    options.onModelCall ?? ((move) => modelCalls.push(move)),
  );
  const settings = resolveSettings(
    { model: "test/coder", price: { inputPerMTok: 3, outputPerMTok: 6 } },
    { temperature: 0, maxTokens: 1000, thinking: "default", cache: false },
  );
  const graph = agentLoopGraph(
    {
      agent: {
        name: AGENT,
        binding: { model, settings },
        instructions: async () => "You change files in the repository.",
        tools: (options.tools ?? repoTools)(log),
        limits: { modelCalls: 12, toolCalls: 20, ...options.limits },
        historyLimit: 0,
        summariesLimit: 0,
        knowledge: [],
      },
      bundle: "test-bundle",
      runBudgetCap: options.runBudgetCap ?? Number.POSITIVE_INFINITY,
      approval: options.approval === false ? undefined : pauseSeamApproval(),
      judges: noJudges,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      guardrails: options.guardrails
        ? { override: false, instances: options.guardrails }
        : undefined,
    },
    checkpointer,
  );
  return { graph, effects, modelCalls, model };
}

const flowStateOf = (task: string): FlowStateType => ({
  task,
  startInput: { text: task },
  finishes: {},
  optionalBranches: [],
  history: [],
  runId: "run-1",
  next: "",
  routeReason: "",
  contributions: [],
  usage: [],
  budgetUsd: Number.POSITIVE_INFINITY,
  replyWith: "",
  guarded: "",
  approvals: [],
  summaries: [],
  start: "",
  previousAgent: "",
  visits: {},
  steps: 0,
  path: ["workflow-start.chat", "main"],
  daySpentBeforeRunUsd: null,
  forks: {},
  payload: {},
  batchItem: undefined,
  _batchCursor: {},
  cancelRequested: false,
  batchIndex: undefined,
  lastError: null,
});

/** The loop's input for a task,
  finishes: {},
  optionalBranches: [], as the agent's flow node hands it over. */
export const startInput = (task = "change a.ts"): AgentLoopStateType =>
  loopInputOf(flowStateOf(task), AGENT);

/** A thread's run config: every step checkpointed before the next one starts. */
export interface ThreadConfig {
  readonly configurable: { readonly thread_id: string };
  readonly durability: "sync";
}

export const threadConfig = (thread: string): ThreadConfig => ({
  configurable: { thread_id: thread },
  durability: "sync",
});

/** How a loop invocation ended: the agent's reply, or a pause with the pending call. */
export type LoopEnd =
  | { readonly kind: "answered"; readonly reply: string }
  | { readonly kind: "paused"; readonly pending: unknown };

export async function stateOf(graph: AgentLoopGraph, thread: string): Promise<AgentLoopStateType> {
  // LangGraph boundary: snapshot values are the loop's own state
  return (await graph.getState(threadConfig(thread))).values as AgentLoopStateType;
}

export async function endOf(graph: AgentLoopGraph, thread: string): Promise<LoopEnd> {
  const snapshot = await graph.getState(threadConfig(thread));
  const [first] = snapshot.tasks.flatMap((task) => task.interrupts);
  if (first !== undefined) return { kind: "paused", pending: first.value };
  return { kind: "answered", reply: (await stateOf(graph, thread)).reply ?? "" };
}

type LoopInput = Parameters<AgentLoopGraph["invoke"]>[0];

export async function runLoop(
  graph: AgentLoopGraph,
  input: LoopInput,
  thread: string,
): Promise<LoopEnd> {
  await graph.invoke(input, threadConfig(thread));
  return endOf(graph, thread);
}

export const decision = (decided: ToolCallApprovalDecision): LoopInput =>
  new Command<ToolCallApprovalDecision, AgentLoopUpdate, never>({ resume: decided });

/** The tool messages a model request carried: [callId, content] in order. */
export const toolMessagesOf = (messages: readonly BaseMessage[] | undefined): string[][] =>
  (messages ?? [])
    .filter((message) => ToolMessage.isInstance(message))
    .map((message) => [message.tool_call_id, message.text]);

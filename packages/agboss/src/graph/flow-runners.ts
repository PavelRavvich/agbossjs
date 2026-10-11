import type { MessageContent } from "@langchain/core/messages";
import { WorkflowCancelledError } from "../core/errors.js";
import { extractRunContext } from "../core/run-context.js";

import { agentDefinitions } from "./agent-definitions.js";
import {
  agentLoopGraph,
  agentRunner,
  noJudges,
  pauseSeamApproval,
  type AgentLoopGraph,
} from "./agent-loop/index.js";
import type { GraphDeps } from "./deps.js";
import type { FlowNodeRef } from "./flow-nodes.js";
import { lastAnswer } from "./nodes/finalize.js";
import { makeGuardNode } from "./nodes/guards.js";
import type { FlowNodeRunner } from "./visit.js";
import type { MultimodalFinishOutput } from "../app/types.js";

import { actionRunner } from "./flow-action-runner.js";
import type { RunLimits } from "./flow-runtime.js";

export { UnknownActionError } from "./flow-action-runner.js";

class UnknownAgentError extends Error {
  override name = "UnknownAgentError";
  constructor(agent: string) {
    super(`Unknown agent: ${agent}`);
  }
}

/** The content blocks of a multimodal contribution ([] for text or no contribution). */
const contentBlocks = (content: MessageContent | undefined): MultimodalFinishOutput["blocks"] =>
  Array.isArray(content) ? content : [];

/** A workflow finish: the replyWith is the last contribution, checked by the output guards. */
function finishRunner<TName extends string>(deps: GraphDeps<TName>, name: string): FlowNodeRunner {
  const outputGuards = makeGuardNode(deps.guards.output, "output");
  return async (state, config) => {
    const replyWith = lastAnswer(state);
    const guarded = await outputGuards({ ...state, replyWith }, config);
    const finishOutput: MultimodalFinishOutput = {
      kind: "multimodal",
      blocks: contentBlocks(state.contributions.at(-1)?.content),
    };
    return { replyWith, finishes: { [name]: finishOutput }, ...guarded };
  };
}

/** Each configured agent's own loop, compiled once per graph (approval only with a pause seam). */
function agentLoops<TName extends string>(
  deps: GraphDeps<TName>,
): ReadonlyMap<string, AgentLoopGraph> {
  const approval =
    deps.pause === undefined
      ? undefined
      : pauseSeamApproval({
          dispatch: deps.requestApproval,
          adapterOf: deps.channelAdapters,
          observer: deps.observer,
        });
  const runBudgetCap = deps.limits.perRun?.cost ?? Number.POSITIVE_INFINITY;
  return new Map(
    [...agentDefinitions(deps)].map(([name, agent]) => [
      name,
      agentLoopGraph(
        {
          agent,
          bundle: deps.config.name,
          runBudgetCap,
          approval,
          judges: noJudges,
          piiPolicies: deps.piiPolicies?.(name),
          guardrails: deps.guardrails?.(name),
          observer: deps.observer,
        },
        deps.pause?.checkpointer,
      ),
    ]),
  );
}

/** Whether an error is LangGraph's pause (it must bubble up). */
const isGraphInterrupt = (e: unknown): boolean =>
  typeof e === "object" &&
  e !== null &&
  "name" in e &&
  (e.name === "NodeInterrupt" || e.name === "GraphInterrupt");

/** An agent node: its own loop; a failed optional branch is reported and skipped. */
function agentNodeRunner<TName extends string>(
  loop: AgentLoopGraph,
  deps: GraphDeps<TName>,
  node: FlowNodeRef,
): FlowNodeRunner {
  const runner = agentRunner(loop, node.name);
  const run: FlowNodeRunner = async (state, config) => {
    if (state.cancelRequested) {
      throw new WorkflowCancelledError();
    }
    const runId = state.runId;
    const { threadId } = extractRunContext(config, runId);
    const appState = {
      runId,
      threadId,
      activeNode: node.name,
      variables: {},
      history: state.history,
    };

    await deps.observer?.onAgentStart({ name: node.name, input: state.task, state: appState });
    try {
      const result = await runner(state, config);
      await deps.observer?.onAgentEnd({ name: node.name, update: result, state: appState });
      return result;
    } catch (e: unknown) {
      if (isGraphInterrupt(e)) throw e; // Let pauses bubble up

      if (state.optionalBranches.includes(node.name)) {
        // Suppress error for optional branches
        await deps.observer?.onError(e as Error, appState);
        return {};
      }
      throw e;
    }
  };
  return run;
}

/**
 * The runners of the nodes in the flow: a workflow start runs the input guards, an agent runs its
 * own loop (a subgraph: model turns, the move boundary, approval, tool calls), a workflow finish
 * takes the last replyWith and runs the output guards. Routers are the engine's own.
 */
export function flowRunners<TName extends string>(
  deps: GraphDeps<TName>,
  run: RunLimits,
): (node: FlowNodeRef) => FlowNodeRunner {
  const loops = agentLoops(deps);
  const inputGuards = makeGuardNode(deps.guards.input, "input");

  return (node) => {
    switch (node.kind) {
      case "quorumRouter":
      case "router":
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- routers have no runner here (the engine owns them); callers get `undefined`, which visitNode would only fail on when run; see #180 report
        return undefined as any;
      case "workflow-start":
        return inputGuards;
      case "action":
        return actionRunner(deps, run, loops, node);
      case "workflow":
        // the engine runs a nested workflow as its compiled subgraph (`nestedWorkflowRunner`)
        throw new Error(`Nested workflow "${node.name}" has no runner of its own`);
      case "agent": {
        const loop = loops.get(node.name);
        if (loop === undefined) throw new UnknownAgentError(node.name);
        return agentNodeRunner(loop, deps, node);
      }
      case "workflow-finish":
        return finishRunner(deps, node.name);
    }
  };
}

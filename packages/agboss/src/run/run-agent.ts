import { randomUUID } from "node:crypto";
import type { UsageRecord } from "../finops/usage.js";
import type { FlowModel } from "../graph/check-flow.js";
import { workflowStartMetaOf } from "../graph/workflow-start.decorator.js";
import { flowGraphOf } from "../graph/flow-runtime.js";
import { WorkflowStartText } from "../dto/standard/framework.js";
import { RunInputSchema } from "../input.js";
import {
  allowedBudget,
  drainRun,
  failedOutcome,
  outcomeError,
  recorder,
  workflowAccount,
  type TernBase,
} from "./execute.js";
import { inRunScope } from "../components/run-scope.js";
import { quorumOf, settleQuorum, withMetadata } from "./run-services.js";
import { streamConfig } from "./stream-config.js";
import { finishRun } from "./finish.js";
import { openThread } from "./thread.js";
import type { AgentExecutionOutput, RunDeps, RunOptions } from "./types.js";
import { runVersions } from "./versions.js";

/** The workflow start a task goes to: the one asked for, else the text start (input `WorkflowStartText`). */
function startFor(model: FlowModel, requested: string | undefined): string {
  if (requested !== undefined) return requested;
  const starts = [...model.nodes.values()].filter((ref) => ref.kind === "workflow-start");
  const text = starts.find((ref) => workflowStartMetaOf(ref.use)?.input === WorkflowStartText);
  return (text ?? starts[0])?.name ?? "";
}

/**
 * Public entry point: validates input, opens or continues a thread, checks the daily cap (nothing
 * left → no calls), runs the flow within the workflow's limits, records spend as it happens and
 * writes a Tern for every outcome — answered, guarded, paused or failed (a limit, a router).
 * The run has its own run-scoped components (`scope: "run"`), destroyed when it ends.
 */
export function runAgent<TName extends string>(
  input: unknown,
  deps: RunDeps<TName>,
  options: RunOptions = {},
): Promise<AgentExecutionOutput> {
  return inRunScope(() => runOnce(input, deps, options));
}

/** What every Tern of the run has: its run, thread, task, replay and versions. */
const ternBaseOf = <TName extends string>(
  deps: RunDeps<TName>,
  run: Pick<TernBase, "runId" | "threadId" | "task">,
  options: RunOptions,
): TernBase => ({
  ...run,
  bundle: deps.config.name,
  replayOf: options.replayOf ?? null,
  ...runVersions(deps),
});

async function runOnce<TName extends string>(
  input: unknown,
  deps: RunDeps<TName>,
  options: RunOptions,
): Promise<AgentExecutionOutput> {
  const parsed = RunInputSchema.parse(input);
  const { task, threadId: requested, start } = parsed;
  const startInput = parsed.input ?? { text: task };
  const account = options.account ?? workflowAccount(deps);
  const { threadId, history, summaries } = await openThread(deps, requested);
  const spent: UsageRecord[] = [];
  const runId = options.runId ?? deps.newRunId?.() ?? randomUUID();
  const base = ternBaseOf(deps, { runId, threadId, task }, options);
  let release = (): void => undefined;
  try {
    const { budgetUsd, run, hold } = await allowedBudget(deps, account);
    release = hold.release;
    const flow = await flowGraphOf(deps, run);
    const quorumManager = quorumOf(deps, runId);
    const identity = { threadId, runId, quorumManager, input: startInput };
    const config = streamConfig(deps, identity, options);
    const record = recorder(hold, spent);
    const initial = {
      task,
      startInput,
      budgetUsd,
      history,
      summaries,
      runId,
      start: startFor(flow.model, start),
    };
    const state = await drainRun(await flow.graph.stream(initial, config), record);
    const recorded = state.usage.length;
    const context = { deps, flow, base, runId, budgetUsd, record, recorded };
    const output = await finishRun({ ...context, callbacks: config.callbacks }, state);
    settleQuorum(deps, runId, quorumManager, output.status === "paused");
    return withMetadata(output, options.metadata);
  } catch (error) {
    const cause = outcomeError(error, options.signal);
    await deps.terns.append({ ...base, ...failedOutcome(cause, spent) });
    throw cause;
  } finally {
    // ended or paused: what the run did not spend goes back to the day (a resume reserves anew)
    release();
  }
}

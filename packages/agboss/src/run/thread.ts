import { AGBossError } from "../core/errors.js";
import type { HistoryTurn } from "../graph/contributions.js";
import type { Tern, TernStore } from "../terns/index.js";
import type { RunDeps } from "./types.js";

export class UnknownThreadError extends AGBossError {
  static override readonly code: string = "run.unknown-thread";
  override name = "UnknownThreadError";
}

/** A thread used by a caller that is not its owner (`execute`, `resume`, `cancel` with `owner`). */
export class ThreadOwnerError extends AGBossError {
  static override readonly code: string = "run.thread-owner";
  override name = "ThreadOwnerError";
}

const notTheOwner = (threadId: string): ThreadOwnerError =>
  new ThreadOwnerError(`Thread "${threadId}" belongs to another owner`, {
    details: { thread: threadId },
  });

/**
 * A thread is used only by the owner it was created for (`ExecutionOptions.owner`): a different
 * owner, or none for an owned thread (and the other way round), fails before anything runs. The
 * message names neither owner. A thread the store does not know is left to the caller's own check.
 */
export async function checkThreadOwner(
  terns: Pick<TernStore, "threadOwner">,
  bundle: string,
  threadId: string,
  owner: string | undefined,
): Promise<void> {
  const thread = await terns.threadOwner(bundle, threadId);
  if (thread === undefined || thread.owner === owner) return;
  throw notTheOwner(threadId);
}

const unknownThread = (bundle: string, threadId: string): UnknownThreadError =>
  new UnknownThreadError(`Unknown thread "${threadId}" for "${bundle}"`);

/** `execute` on a given thread: it must exist for this workflow and belong to the caller's owner. */
export async function checkThreadAccess(
  terns: Pick<TernStore, "threadOwner">,
  bundle: string,
  threadId: string,
  owner: string | undefined,
): Promise<void> {
  const thread = await terns.threadOwner(bundle, threadId);
  if (thread === undefined) throw unknownThread(bundle, threadId);
  if (thread.owner !== owner) throw notTheOwner(threadId);
}

/** Deepest history any router (defaults) or agent of the config may need. */
function historyDepth<TName extends string>(deps: RunDeps<TName>): number {
  const agentLimits = Object.values<{ readonly historyLimit?: number }>(deps.config.agents).map(
    (agent) => agent.historyLimit ?? 0,
  );
  return Math.max(deps.config.defaults.history.limit, ...agentLimits);
}

/** Deepest summary list any reader needs (compaction). */
function summariesDepth<TName extends string>(deps: RunDeps<TName>): number {
  const fallback = deps.config.defaults.history.summaries ?? deps.config.compaction?.keep ?? 0;
  const agentLimits = Object.values<{ readonly historySummaries?: number }>(deps.config.agents).map(
    (agent) => agent.historySummaries ?? fallback,
  );
  return Math.max(fallback, ...agentLimits);
}

const toTurns = (terns: readonly Tern[]): HistoryTurn[] =>
  terns.map(({ task, replyWith, status }) => ({ task, replyWith, status }));

/** With compaction: the latest summaries + raw turns not yet summarised; without: the last turns. */
async function memoryOf<TName extends string>(
  deps: RunDeps<TName>,
  threadId: string,
): Promise<{ readonly history: HistoryTurn[]; readonly summaries: string[] }> {
  if (deps.config.compaction === undefined) {
    return {
      history: toTurns(await deps.terns.lastTerns(threadId, historyDepth(deps))),
      summaries: [],
    };
  }
  const raw = await deps.terns.uncovered(threadId);
  const summaries = await deps.terns.latestSummaries(threadId, summariesDepth(deps));
  return {
    history: toTurns(raw.slice(-historyDepth(deps))),
    summaries: summaries.map((summary) => summary.text),
  };
}

/** First contact → a new thread; a given id must exist for this workflow (validation, no calls). */
export async function openThread<TName extends string>(
  deps: RunDeps<TName>,
  requested: string | undefined,
): Promise<{
  readonly threadId: string;
  readonly history: HistoryTurn[];
  readonly summaries: string[];
}> {
  const bundle = deps.config.name;
  if (requested === undefined) {
    return { threadId: await deps.terns.createThread(bundle), history: [], summaries: [] };
  }
  if (!(await deps.terns.hasThread(bundle, requested))) {
    throw unknownThread(bundle, requested);
  }
  return { threadId: requested, ...(await memoryOf(deps, requested)) };
}

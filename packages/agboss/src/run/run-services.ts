import { QuorumManager } from "../concurrency/quorum-manager.js";
import type { AgentExecutionOutput, RunDeps } from "./types.js";

/**
 * The quorum votes of the runs paused on a checkpointer: a resume continues counting the votes its
 * branches cast before the pause (in this process; a restart starts the count again).
 */
const pausedQuorums = new WeakMap<object, Map<string, QuorumManager>>();

const quorumsOf = <TName extends string>(
  deps: RunDeps<TName>,
): Map<string, QuorumManager> | undefined => {
  const store = deps.pause?.checkpointer;
  if (store === undefined) return undefined;
  let quorums = pausedQuorums.get(store);
  if (quorums === undefined) {
    quorums = new Map();
    pausedQuorums.set(store, quorums);
  }
  return quorums;
};

/** The run's quorum manager: the one it paused with, else a new one. */
export function quorumOf<TName extends string>(deps: RunDeps<TName>, runId: string): QuorumManager {
  return quorumsOf(deps)?.get(runId) ?? new QuorumManager();
}

/** Keeps a paused run's quorum votes for its resume; forgets them when the run ended. */
export function settleQuorum<TName extends string>(
  deps: RunDeps<TName>,
  runId: string,
  manager: QuorumManager,
  paused: boolean,
): void {
  const quorums = quorumsOf(deps);
  if (paused) quorums?.set(runId, manager);
  else quorums?.delete(runId);
}

/** The run's output carrying its metadata (when it has any), for its resume. */
export const withMetadata = (
  output: AgentExecutionOutput,
  metadata: Readonly<Record<string, string>> | undefined,
): AgentExecutionOutput =>
  metadata === undefined || Object.keys(metadata).length === 0 ? output : { ...output, metadata };

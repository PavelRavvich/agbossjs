import { NotPausedError } from "../run/resume-agent.js";
import {
  checkResume,
  type IncompatibleResumePolicy,
  type ResumeVersions,
} from "../run/resume-guard.js";
import type { AgentExecutionOutput } from "../run/types.js";

/** A paused run and the workflow version / config hash it paused under (checked on resume). */
export interface PausedRun extends ResumeVersions {
  readonly run: AgentExecutionOutput;
}

/**
 * Paused runs by thread: what `app.resume(thread, …)` continues. A paused run survives a restart
 * only when both this repository and the app's checkpointer (`stores.checkpointer`) are durable.
 */
export interface PausedRunRepository {
  readonly get: (thread: string) => Promise<PausedRun | undefined>;
  readonly set: (paused: PausedRun) => Promise<void>;
  readonly delete: (thread: string) => Promise<void>;
}

/** Paused runs in memory: one app, or every app of one test sharing it. Lost on restart. */
export function createMemoryPausedRunRepository(): PausedRunRepository {
  const runs = new Map<string, PausedRun>();
  return {
    get: (thread) => Promise.resolve(runs.get(thread)),
    set: (paused) => {
      runs.set(paused.run.threadId, paused);
      return Promise.resolve();
    },
    delete: (thread) => {
      runs.delete(thread);
      return Promise.resolve();
    },
  };
}

/** The app's view of its paused runs: settle each run, hand out a run that may be resumed. */
export interface PausedRunBook {
  /** Remembers a paused run with the app's versions, forgets a thread whose run ended. */
  readonly settle: (run: AgentExecutionOutput) => Promise<void>;
  /** Forgets the thread's paused run (a cancel) and returns it; `undefined` when none waits. */
  readonly drop: (thread: string) => Promise<AgentExecutionOutput | undefined>;
  /** The run paused on `thread`; `NotPausedError` / `IncompatibleResumeError` when it cannot resume. */
  readonly resumable: (thread: string) => Promise<AgentExecutionOutput>;
}

export function pausedRunBook(
  repository: PausedRunRepository,
  current: ResumeVersions,
  policy: IncompatibleResumePolicy | undefined,
): PausedRunBook {
  return {
    settle: (run) =>
      run.status === "paused"
        ? repository.set({ run, ...current })
        : repository.delete(run.threadId),
    drop: async (thread) => {
      const stored = await repository.get(thread);
      if (stored !== undefined) await repository.delete(thread);
      return stored?.run;
    },
    resumable: async (thread) => {
      const stored = await repository.get(thread);
      if (stored === undefined) throw new NotPausedError(`Thread "${thread}" has no paused run`);
      const { run, workflowVersion, configHash } = stored;
      const paused = { workflowVersion, configHash };
      checkResume({ thread, runId: run.runId, paused, current }, policy);
      return run;
    },
  };
}

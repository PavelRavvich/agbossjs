import { z } from "zod";
import { openTernDatabase } from "../terns/index.js";
import type { AgentExecutionOutput } from "../run/types.js";
import { DEFAULT_TERN_DB } from "./app-deps.js";
import type { PausedRun, PausedRunRepository } from "./paused-runs.js";

const PausedRow = z.object({
  run: z.string(),
  workflow_version: z.string(),
  config_hash: z.string(),
});

/** The fields `resume` relies on; the rest of the stored run is passed through as written. */
const StoredRun = z.looseObject({
  status: z.literal("paused"),
  threadId: z.string(),
  runId: z.string(),
  ternId: z.string(),
  // Infinity when the run has no cost limit (z.number() rejects it)
  budgetUsd: z.custom<number>((value) => typeof value === "number" && !Number.isNaN(value)),
});

/** JSON keeps no `Infinity` (a run without a cost limit has `budgetUsd: Infinity`): tag it. */
const NonFinite = z.object({ $number: z.enum(["Infinity", "-Infinity", "NaN"]) });

const encode = (run: AgentExecutionOutput): string =>
  JSON.stringify(run, (_key, value: unknown) =>
    typeof value === "number" && !Number.isFinite(value) ? { $number: String(value) } : value,
  );

const decode = (text: string): unknown =>
  JSON.parse(text, (_key, value: unknown) => {
    const tagged = NonFinite.safeParse(value);
    return tagged.success ? Number(tagged.data.$number) : value;
  });

function toPausedRun(row: unknown): PausedRun {
  const r = PausedRow.parse(row);
  const stored = decode(r.run);
  StoredRun.parse(stored);
  // checked above: a run this repository wrote from an AgentExecutionOutput
  const run = stored as AgentExecutionOutput;
  return { run, workflowVersion: r.workflow_version, configHash: r.config_hash };
}

/** A durable `PausedRunRepository` that can also be closed (its own database connection). */
export interface SqlitePausedRunRepository extends PausedRunRepository {
  readonly close: () => void;
}

/**
 * Paused runs in the Tern database (table `paused_runs`; default path: `TERN_DB` or
 * `~/.langgraph-agents/terns.sqlite`, like the Tern store), so they survive an app restart. Pair it
 * with a durable checkpointer (`stores.checkpointer`): the record says *that* a thread waits, the
 * checkpoint holds *where*. `:memory:` for tests.
 */
export function createSqlitePausedRunRepository(
  path: string = process.env.TERN_DB ?? DEFAULT_TERN_DB,
  now: () => Date = () => new Date(),
): SqlitePausedRunRepository {
  const db = openTernDatabase(path);
  return {
    get: (thread) => {
      const row = db
        .prepare("SELECT run, workflow_version, config_hash FROM paused_runs WHERE thread_id = ?")
        .get(thread);
      return Promise.resolve(row === undefined ? undefined : toPausedRun(row));
    },
    set: ({ run, workflowVersion, configHash }) => {
      db.prepare(
        `INSERT OR REPLACE INTO paused_runs (thread_id, run_id, run, workflow_version, config_hash,
           paused_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(run.threadId, run.runId, encode(run), workflowVersion, configHash, now().toISOString());
      return Promise.resolve();
    },
    delete: (thread) => {
      db.prepare("DELETE FROM paused_runs WHERE thread_id = ?").run(thread);
      return Promise.resolve();
    },
    close: () => {
      db.close();
    },
  };
}

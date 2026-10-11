import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { textOption, workflowPath, type CommandContext } from "./context.js";
import { usageError } from "./errors.js";

/** What `agboss run` runs: the workflow file and the task. */
export interface RunTarget {
  readonly file: string;
  readonly task: string;
}

const isModulePath = (word: string, cwd: string): boolean =>
  /\.[cm]?[jt]s$/.test(word) && existsSync(resolve(cwd, word));

/**
 * `agboss run --workflow <path> "task"` (or `--input "task"`); the older `agboss run <workflow.ts> "task"`
 * still works: a first word that is an existing module file is the workflow.
 */
export function runTargetOf(context: CommandContext): RunTarget {
  const [first, ...others] = context.positionals;
  const legacy = first !== undefined && others.length > 0 && isModulePath(first, context.io.cwd);
  const file = legacy ? first : workflowPath(context);
  const words = legacy ? others : context.positionals;
  const task = textOption(context.values, "input") ?? words.join(" ");
  if (task.trim() === "")
    throw usageError(
      "run",
      "usage.missing-task",
      'missing the task: agboss run --workflow <path> "<task>"',
    );
  return { file, task };
}

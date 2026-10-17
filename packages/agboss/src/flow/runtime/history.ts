import { sortedJson } from "./json.js";

/**
 * The thread's history (#272 S8): only finished root executions are turns, each as its start input
 * and finish output in JSON — two lines, `start <start-name>: <json>` and
 * `finish <finish-name>: <json>`. Intermediate values, agent answers and tool results never enter
 * it, so a refactoring of the graph does not change past turns.
 */
export interface HistoryTurn {
  /** `start chat-workflow-start: {"text":"where is order 7?"}` */
  readonly start: string;
  /** `finish chat-workflow-finish: {"text":"Order 7 has shipped."}` */
  readonly finish: string;
}

/** The start line of a turn. */
export const startLine = (start: string, input: unknown): string =>
  `start ${start}: ${sortedJson(input)}`;

/** The finish line of a turn. */
export const finishLine = (finish: string, output: unknown): string =>
  `finish ${finish}: ${sortedJson(output)}`;

/** The last `limit` turns, oldest first, as the model reads them; "" when there are none. */
export function formatHistory(history: readonly HistoryTurn[], limit: number): string {
  const turns = limit > 0 ? history.slice(-limit) : [];
  if (turns.length === 0) return "";
  const lines = turns.map((turn) => `${turn.start}\n${turn.finish}`);
  return `Earlier executions on this thread:\n${lines.join("\n\n")}`;
}

/** The latest `limit` compaction summaries, oldest first; "" when there are none. */
export function formatSummaries(summaries: readonly string[], limit: number): string {
  const notes = limit > 0 ? summaries.slice(-limit) : [];
  if (notes.length === 0) return "";
  return `Earlier in this conversation:\n${notes.map((note, i) => `[${String(i + 1)}] ${note}`).join("\n\n")}`;
}

/** What a reader remembers of the thread: its summaries, then its raw turns ("" for nothing). */
export function formatMemory(
  memory: { readonly summaries: readonly string[]; readonly history: readonly HistoryTurn[] },
  limits: { readonly summaries: number; readonly turns: number },
): string {
  return [
    formatSummaries(memory.summaries, limits.summaries),
    formatHistory(memory.history, limits.turns),
  ]
    .filter((part) => part !== "")
    .join("\n\n");
}

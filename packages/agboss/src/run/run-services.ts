import type { AgentExecutionOutput } from "./types.js";

/** The run's output carrying its metadata (when it has any), for its resume. */
export const withMetadata = (
  output: AgentExecutionOutput,
  metadata: Readonly<Record<string, string>> | undefined,
): AgentExecutionOutput =>
  metadata === undefined || Object.keys(metadata).length === 0 ? output : { ...output, metadata };

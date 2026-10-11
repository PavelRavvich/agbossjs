import type { MessageContent } from "@langchain/core/messages";
import { mergeContent } from "../graph/multimodal.js";

/** The agent's user message: the task and what other agents already contributed. */
export const renderAgentInput = (
  task: string,
  contributions: MessageContent,
  history = "",
  decisions = "",
): MessageContent =>
  mergeContent(`${history}Task:\n${task}\n\nPrevious contributions:\n`, contributions, decisions);

/** What the model reads when a call was rejected — `by` and `reason` from the decision. */
export const rejectionMessage = (by: string, reason: string | undefined): string =>
  `Tool error: the call was rejected by ${by}${reason === undefined ? "" : `: ${reason}`}`;

/** What the model reads when it called a tool the agent does not have. */
export const unknownToolMessage = (tool: string): string =>
  `Tool error: there is no tool "${tool}"`;

/** Final message of an agent whose loop was stopped by the run budget. */
export const BUDGET_STOP_MESSAGE = "stopped: run budget exhausted";

/** Texts the agent's loop shows the model — part of the prompt version. */
export const agentLoopPromptTexts: readonly string[] = [
  rejectionMessage("", ""),
  unknownToolMessage(""),
];

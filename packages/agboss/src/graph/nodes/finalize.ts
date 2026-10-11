import { extractText } from "../multimodal.js";
import type { AgentStateType } from "../state.js";

export const NO_ANSWER = "No agent produced an replyWith.";

/** The replyWith of a workflow finish: the latest contribution. */
export const lastAnswer = (state: Pick<AgentStateType, "contributions">): string => {
  const content = state.contributions.at(-1)?.content;
  return content ? extractText(content) : NO_ANSWER;
};

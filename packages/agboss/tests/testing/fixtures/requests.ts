import { extractText } from "../../../src/graph/multimodal.js";
import type { ModelRequest } from "../../../src/testing/index.js";

/** The tool results an agent's request carried back to its model, in order. */
export const toolResultsOf = (request: ModelRequest): string[] =>
  request.kind === "chat"
    ? request.messages.filter((line) => line.role === "tool").map((line) => extractText(line.text))
    : [];

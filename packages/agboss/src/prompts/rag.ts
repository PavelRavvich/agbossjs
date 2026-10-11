import type { RagSearchResult } from "../dto/standard/framework.js";

/** Asked of the model in both modes. Part of the prompt version. */
export const CITE_INSTRUCTION =
  "Answer from these search results when they are relevant and cite each fact's source as [source]. Say when they do not cover the question.";

/** Suffix of a knowledge base's search tool description. */
export const SEARCH_TOOL_SUFFIX =
  "Returns the most relevant search results with their source; cite them as [source].";

/** Context mode: search results put before the task. */
export const knowledgeBlock = (name: string, results: readonly RagSearchResult[]): string =>
  `Knowledge (${name}):\n${results.map((r) => `[${r.source}] ${r.text}`).join("\n\n")}`;

export const ragPromptTexts: readonly string[] = [
  CITE_INSTRUCTION,
  SEARCH_TOOL_SUFFIX,
  knowledgeBlock("", []),
];

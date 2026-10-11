import { ChatPromptTemplate } from "@langchain/core/prompts";

/** Jev question text. Options arrive as criteria. */
export const jevRouteInstructions =
  "Which option should handle this next? Pick the option whose description fits the input best.";

const LLM_ROUTER_SYSTEM = [
  "You are a router. Pick exactly one option for the input.",
  "Options:",
  "{options}",
  "",
  'Reply with JSON only: {{"next": "<option name>", "reason": "<short reason>"}}.',
].join("\n");

/** LLM router prompt. */
export const llmRouterPrompt = ChatPromptTemplate.fromMessages([
  ["system", LLM_ROUTER_SYSTEM],
  ["human", "{input}"],
]);

/** Every prompt text routers use — part of the prompt version of a run. */
export const routerPromptTexts: readonly string[] = [jevRouteInstructions, LLM_ROUTER_SYSTEM];

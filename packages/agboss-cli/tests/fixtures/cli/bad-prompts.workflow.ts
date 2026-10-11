import { workflowWith } from "../../../../agboss/tests/components/prompts/flows.js";

/** `agboss check` fixture (#199): a {{typo}} in the agent's prompt file and one in the router's prompt. */
export const BadPrompts = workflowWith({
  agent: { promptUrls: ["./typo.prompt.md"] },
  router: "Pick one.\nThe boards: {{bords}}",
}).workflow;

import { Agent, Workflow, from, Router, type Flow } from "../../../src/index.js";
import type { FlowNodeClass } from "../../../src/graph/flow.js";
import type { Class } from "../../../src/components/injection.js";
import { testConfig } from "../../helpers.js";
import { TestAnswer, TestChat } from "../../fixtures/test-flow/test.flow.js";
import { TestSettings } from "../../fixtures/test-flow/star.js";

/** Prompts of one flow: the agent's (inline or files), the router's and its route's. */
export interface FlowPrompts {
  readonly agent?: { readonly prompt?: string; readonly promptUrls?: readonly string[] };
  readonly router?: string;
  readonly route?: string;
}

const price = testConfig.agents.alpha.price;

/** chat → router "main" ⇄ agent "scout"; "main" → the answer. Variables: boards, boardCount. */
export function workflowWith(prompts: FlowPrompts): {
  workflow: Class;
  router: FlowNodeClass;
  scout: FlowNodeClass;
} {
  @Agent({
    name: "scout",
    description: "Scouts job boards",
    model: "test/alpha",
    price,
    ...(prompts.agent ?? { prompt: "You scout {{boards}}." }),
    promptVariables: { boardCount: "2" },
  })
  class Scout {}

  @Router({
    name: "main",
    description: "Sends the task to the scout, or answers",
    prompt: prompts.router ?? "Pick who handles it.",
    model: "typesafe/jev-1.13",
    maxVisits: 4,
    routes: [
      { prompt: prompts.route ?? "Job boards to scout", target: Scout },
      { prompt: "The answer is ready", target: TestAnswer },
    ],
  })
  class Main {}

  const flow: Flow = [from(TestChat).next(Main), from(Main).routes(), from(Scout).next(Main)];

  @Workflow({
    name: "prompts",
    version: "1.0.0",
    defaults: testConfig.defaults,
    flow,
    promptVariables: { boards: "LinkedIn, AllJobs" },
  })
  class Prompts extends TestSettings {}

  return { workflow: Prompts, router: Main, scout: Scout };
}

/** A workflow whose router and route prompts use the workflow's variables. */
export const Templated = workflowWith({
  router: "Pick who handles it; the boards are {{boards}}.",
  route: "Scouting {{boards}}",
  agent: { promptUrls: ["./scout.prompt.md"] },
});

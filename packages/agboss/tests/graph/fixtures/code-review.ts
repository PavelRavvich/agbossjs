import { chain, from, type Flow } from "../../../src/graph/flow.js";
import { Router } from "../../../src/graph/router.decorator.js";
import { testNode } from "./nodes.js";

@testNode("workflow-start", "chat")
export class ChatWorkflowStart {}

@testNode("agent", "explainer")
export class ExplainerAgent {}

@testNode("agent", "coder")
export class CoderAgent {}

@testNode("agent", "reviewer")
export class ReviewerAgent {}

@testNode("workflow-finish", "replyWith")
export class AnswerWorkflowFinish {}

@testNode("workflow-finish", "pull-request")
export class PullRequestWorkflowFinish {}

@Router({
  name: "main",
  description: "Sends the message to the right agent",
  prompt: "Pick who handles the message.",
  model: "typesafe/jev-1.13",
  routes: [
    { prompt: "Explaining code", target: ExplainerAgent },
    { prompt: "Writing code", target: CoderAgent },
  ],
})
export class MainRouter {}

@Router({
  name: "review-gate",
  description: "Sends the code back or opens the pull request",
  prompt: "Is the review clean?",
  model: "typesafe/jev-1.13",
  maxVisits: 3,
  routes: [
    { prompt: "The review asks for changes", target: CoderAgent },
    { prompt: "The review is clean", target: PullRequestWorkflowFinish },
  ],
})
export class ReviewGateRouter {}

/** The code-review shape: workflow start → router → agents → gate router cycle → workflow finishes. */
export const codeReviewFlow: Flow = [
  from(ChatWorkflowStart).next(MainRouter),
  from(MainRouter).routes(),
  from(ExplainerAgent).next(AnswerWorkflowFinish),
  chain(CoderAgent, ReviewerAgent, ReviewGateRouter),
  from(ReviewGateRouter).routes(),
];

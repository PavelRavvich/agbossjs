import { extractText } from "../../src/graph/multimodal.js";
import { describe, expect, it } from "vitest";
import {
  assembleFlowGraph,
  graphNodeId,
  UnknownWorkflowStartError,
} from "../../src/graph/build.js";
import { from, Self, type Flow } from "../../src/graph/flow.js";
import { Router } from "../../src/graph/router.decorator.js";
import { codeReviewFlow } from "./fixtures/code-review.js";
import { scriptedRouter, testNode, testRuntime } from "./fixtures/nodes.js";
import { A, B, Done, Start } from "./fixtures/rule-nodes.js";

@testNode("workflow-start", "webhook")
class WebhookWorkflowStart {}

@Router({
  name: "spin",
  description: "Loops back to the agent",
  prompt: "Again?",
  model: "typesafe/jev-1.13",
  maxVisits: 25,
  routes: [
    { prompt: "Once more", target: Self },
    { prompt: "Enough", target: Done },
  ],
})
class Spin {}

@Router({
  name: "star",
  description: "Sends the message to an agent, or sends the replyWith",
  prompt: "Pick who handles the message.",
  model: "typesafe/jev-1.13",
  maxVisits: 3,
  routes: [
    { prompt: "A work", target: A },
    { prompt: "B work", target: B },
    { prompt: "The replyWith covers it", target: Done },
  ],
})
class Star {}

/** The job-scout shape: workflow start → router star → agent → router again → … → workflow finish. */
const starFlow: Flow = [from(Start).next(Star), from(Star).routes(), from(A, B).next(Star)];

const twoStarts: Flow = [from(Start, WebhookWorkflowStart).next(A), from(A).next(Done)];

describe("AC1: the flow runs as a LangGraph graph", () => {
  it("runs the code-review shape from workflow start to workflow finish, through the gate-router cycle", async () => {
    const routers = {
      main: scriptedRouter("main", ["coder"]),
      "review-gate": scriptedRouter("review-gate", ["coder", "pull-request"]),
    };
    const { graph } = await assembleFlowGraph(codeReviewFlow, testRuntime(routers));

    const state = await graph.invoke({ task: "add a feature" });

    expect(state.path).toEqual([
      "workflow-start.chat",
      "main",
      "coder",
      "reviewer",
      "review-gate",
      "coder",
      "reviewer",
      "review-gate",
      "pull-request",
    ]);
    expect(state.replyWith).toBe("reviewer answered");
    expect(state.steps).toBe(7);
    expect(state.visits).toMatchObject({
      coder: 2,
      "review-gate": 2,
      "workflow-start.chat": 1,
      "pull-request": 1,
    });
  });

  it("runs a star: the router sends to agents and back until it sends the replyWith", async () => {
    const star = scriptedRouter("star", ["a", "b", "done"]);
    const { graph } = await assembleFlowGraph(starFlow, testRuntime({ star }));

    const state = await graph.invoke({ task: "find jobs" });

    expect(state.path).toEqual(["workflow-start.start", "star", "a", "star", "b", "star", "done"]);
    expect(state.replyWith).toBe("b answered");
    expect(
      star.requests.map((request) => extractText(request.input).includes("[a]\na answered")),
    ).toEqual([false, true, true]);
  });

  it("#141 AC2: one graph node per flow node, named <kind>.<name>", async () => {
    const routers = { main: scriptedRouter("main", []), "review-gate": scriptedRouter("g", []) };
    const { graph } = await assembleFlowGraph(codeReviewFlow, testRuntime(routers));

    expect(Object.keys((await graph.getGraphAsync()).nodes).sort()).toEqual([
      "__end__",
      "__start__",
      "agent.coder",
      "agent.explainer",
      "agent.reviewer",
      "router.main",
      "router.review-gate",
      "skip-wrap",

      "workflow-finish.pull-request",
      "workflow-finish.replyWith",
      "workflow-start.chat",
    ]);
    expect(graphNodeId({ kind: "router", name: "main" })).toBe("router.main");
  });

  it("starts at the workflow start named in the input when the flow has several", async () => {
    const { graph } = await assembleFlowGraph(twoStarts, testRuntime({}));

    const state = await graph.invoke({ task: "event", start: "webhook" });

    expect(state.path).toEqual(["workflow-start.webhook", "a", "done"]);
  });

  it("fails on a workflow start the flow does not have", async () => {
    const { graph } = await assembleFlowGraph(twoStarts, testRuntime({}));

    await expect(graph.invoke({ task: "event", start: "ghost" })).rejects.toBeInstanceOf(
      UnknownWorkflowStartError,
    );
  });

  it("runs past LangGraph's default recursion limit when the steps limit allows it", async () => {
    const flow: Flow = [from(Start).next(A), from(A).next(Spin), from(Spin).routes()];
    const spin = scriptedRouter("spin", [...Array<string>(20).fill("self"), "done"]);
    const built = await assembleFlowGraph(
      flow,
      testRuntime({ spin }, { limits: { perRun: { steps: 60 } } }),
    );

    const state = await built.graph.invoke({ task: "loop" });

    expect(state.steps).toBe(42);
    expect(built.recursionLimit).toBeGreaterThan(60);
  });
});

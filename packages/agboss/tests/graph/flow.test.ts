import { describe, expect, it } from "vitest";
import { chain, from, isNamedNode, labelOf, node, Self } from "../../src/graph/flow.js";
import { collectFlow } from "../../src/graph/flow-nodes.js";
import { Router } from "../../src/graph/router.decorator.js";
import { testNode } from "./fixtures/nodes.js";
import { AnswerWorkflowFinish, codeReviewFlow, CoderAgent } from "./fixtures/code-review.js";

@testNode("agent", "a")
class A {}

@testNode("agent", "b")
class B {}

@Router({
  name: "r",
  description: "Picks A, B or the agent before it",
  prompt: "Pick.",
  model: "typesafe/jev-1.13",
  routes: [
    { prompt: "A", target: A },
    { prompt: "B", target: B },
    { prompt: "Again", target: Self },
  ],
})
class R {}

const transitionsOf = (flow: Parameters<typeof collectFlow>[0]) =>
  collectFlow(flow).transitions.map((t) => ({ from: t.from, next: t.next }));

describe("AC1: flow DSL builds the expected transitions", () => {
  it("from(A).next(B) is one unconditional step", () => {
    expect(transitionsOf([from(A).next(B)])).toEqual([
      { from: "a", next: { kind: "to", targets: ["b"] } },
    ]);
  });

  it("from(A, B).next(C) fans in: one step from each source", () => {
    expect(transitionsOf([from(A, B).next(AnswerWorkflowFinish)])).toEqual([
      { from: "a", next: { kind: "to", targets: ["replyWith"] } },
      { from: "b", next: { kind: "to", targets: ["replyWith"] } },
    ]);
  });

  it("chain(A, B, C) is from(A).next(B) + from(B).next(C)", () => {
    expect(transitionsOf([chain(A, B, AnswerWorkflowFinish)])).toEqual([
      { from: "a", next: { kind: "to", targets: ["b"] } },
      { from: "b", next: { kind: "to", targets: ["replyWith"] } },
    ]);
  });

  it("from(Router).routes() is one choice with every target; Self is kept as a flag", () => {
    expect(transitionsOf([from(R).routes()])).toEqual([
      {
        from: "r",
        next: {
          kind: "choose",
          targets: ["a", "b"],
          self: true,
          end: false,
          return: false,
          optionNames: ["a", "b"],
          parallelTargets: [],
        },
      },
    ]);
  });

  it("node(Class, name) is a second place for the same class under its own name", () => {
    const SecondA = node(A, "a-again");

    const collected = collectFlow([from(A).next(SecondA)]);

    expect([...collected.nodes.keys()]).toEqual(["a", "a-again"]);
    expect(collected.nodes.get("a-again")).toMatchObject({ kind: "agent", use: A });
    expect(collected.keyOf(SecondA)).toBe("a-again");
  });

  it("the code-review flow has every node once, with its kind", () => {
    const { nodes } = collectFlow(codeReviewFlow);

    expect([...nodes.values()].map((ref) => `${ref.kind}:${ref.name}`)).toEqual([
      "workflow-start:chat",
      "router:main",
      "agent:explainer",
      "agent:coder",
      "workflow-finish:replyWith",
      "agent:reviewer",
      "router:review-gate",
      "workflow-finish:pull-request",
    ]);
    expect(collectFlow(codeReviewFlow).keyOf(CoderAgent)).toBe("coder");
  });

  it("labels say what a person wrote", () => {
    const named = node(A, "x");

    expect([labelOf(A), labelOf(named), labelOf(Self), isNamedNode(named)]).toEqual([
      "A",
      'node(A, "x")',
      "Self",
      true,
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { checkFlow } from "../../src/graph/check-flow.js";
import { chain, from, node, Self, type Flow } from "../../src/graph/flow.js";
import { GraphRuleError, type RuleCode } from "../../src/graph/rule-error.js";
import { codeReviewFlow } from "./fixtures/code-review.js";
import { testNode } from "./fixtures/nodes.js";
import {
  A,
  AlsoNamedA,
  B,
  Done,
  Gate,
  Mute,
  Only,
  OtherA,
  OtherDone,
  Pick,
  Ping,
  Pong,
  Second,
  SomeTool,
  Start,
} from "./fixtures/rule-nodes.js";

function violationsOf(flow: Flow): GraphRuleError {
  try {
    checkFlow(flow);
  } catch (error) {
    if (error instanceof GraphRuleError) return error;
    throw error;
  }
  throw new Error("expected a GraphRuleError");
}

const codesOf = (flow: Flow): RuleCode[] => violationsOf(flow).violations.map((item) => item.code);

describe("AC1: assembly rules", () => {
  it("a valid flow assembles (the code-review shape)", () => {
    expect(checkFlow(codeReviewFlow).nodes.size).toBe(8);
  });

  it("a router with one route and a workflow finish reached from two routers assemble", () => {
    const flow: Flow = [
      from(Start).next(Second),
      from(Second).routes(),
      from(A).next(Only),
      from(Only).routes(),
    ];

    expect(checkFlow(flow).next.get("only")).toEqual({
      kind: "choose",
      targets: ["done"],
      self: false,
      end: false,
      return: false,
      optionNames: ["done"],
      parallelTargets: [],
    });
  });

  it.each<[RuleCode, Flow]>([
    ["graph.not-a-node", [from(Start).next(SomeTool)]],
    ["graph.two-next-steps", [from(Start).next(A), from(A).next(Done), from(A).next(OtherDone)]],
    ["graph.choose-from-non-router", [from(Start).next(A), from(A).routes()]],
    [
      "graph.router-not-last-in-chain",
      [chain(Start, Pick, A), from(A).next(Done), from(B).next(Done)],
    ],
    ["graph.cycle-without-router", [from(Start).next(A), from(A).next(B), from(B).next(A)]],
    [
      "graph.duplicate-node",
      [from(Start).next(A), from(A).next(AlsoNamedA), from(AlsoNamedA).next(Done)],
    ],
    ["graph.no-workflow-start", [from(A).next(Done)]],
    ["graph.unreachable-node", [from(Start).next(Done), from(A).next(Done)]],
    ["graph.dead-end", [from(Start).next(A)]],
    ["graph.next-after-workflow-finish", [from(Start).next(Done), from(Done).next(OtherDone)]],
    [
      // two routers sharing one routes(): their @Router routes must be equal
      "router.routes-mismatch",
      [from(Start).next(Ping), from(A).next(Pong), from(Ping, Pong).routes(), from(B).next(Done)],
    ],
    ["router.self-without-agent-before", [from(Start).next(Gate), from(Gate).routes()]],
  ])("%s", (code, flow) => {
    expect(codesOf(flow)).toContain(code);
  });

  it("graph.duplicate-node-name: one node name declared twice", () => {
    const first = node(B, "again");
    const second = node(OtherA, "again");

    expect(
      codesOf([from(Start).next(first), from(first).next(Done), from(second).next(Done)]),
    ).toContain("graph.duplicate-node-name");
  });

  it("router texts: a router needs a prompt and every route a text", () => {
    const flow: Flow = [from(Start).next(Mute), from(Mute).routes(), from(A).next(Done)];

    expect(codesOf(flow)).toEqual([
      "router.no-prompt",
      "router.empty-route-text",
      "router.empty-route-text",
    ]);
  });

  it("reports several violations together, naming the classes involved", () => {
    const error = violationsOf([
      from(Start).next(Pick),
      from(A).next(Second),
      from(Pick, Second).routes(),
      from(B).next(OtherA),
      from(OtherA).next(B),
    ]);

    expect(error.violations.map((item) => item.code)).toEqual([
      "graph.cycle-without-router",
      "router.routes-mismatch",
      "router.routes-mismatch",
      "router.unbounded-cycle",
    ]);
    expect(error.violations[0]?.nodes).toEqual(["B", "OtherA"]);
    expect(error.violations[1]?.nodes).toEqual(["Pick", "Done"]);
    expect(error.violations[2]?.nodes).toEqual(["Second", "B"]);
    expect(error.message).toContain("breaks 4 rule(s)");
    expect(error.message).toContain("[router.routes-mismatch] router Pick");
  });

  it("Self after two different agents is allowed", () => {
    const flow: Flow = [
      from(Start).next(Pick),
      from(Pick).routes(),
      from(A, B).next(Gate),
      from(Gate).routes(),
    ];

    expect(checkFlow(flow).next.get("gate")).toEqual({
      kind: "choose",
      targets: ["done"],
      self: true,
      end: false,
      return: false,
      optionNames: ["done"],
      parallelTargets: [],
    });
  });

  it("#200: routes() puts every @Router route target into the flow — one without a next step is a dead end", () => {
    const flow: Flow = [from(Start).next(Second), from(Second).routes()];

    expect(violationsOf(flow).violations.map((item) => item.message)).toEqual([
      "A has no next step and is not a workflow finish",
    ]);
  });
});

@testNode("workflow-start", "done")
class StartNamedDone {}

@testNode("workflow-start", "start")
class AlsoNamedStart {}

describe("#141 AC2: workflow start and workflow finish rules", () => {
  it("a flow without a workflow start fails with graph.no-workflow-start", () => {
    const error = violationsOf([from(A).next(Done)]);

    expect(error.violations[0]).toMatchObject({
      code: "graph.no-workflow-start",
      message: "the flow has no workflow start (@WorkflowStart)",
    });
  });

  it("a node after a workflow finish fails with graph.next-after-workflow-finish", () => {
    const error = violationsOf([from(Start).next(Done), from(Done).next(OtherDone)]);

    expect(error.violations[0]).toMatchObject({
      code: "graph.next-after-workflow-finish",
      message: "workflow finish Done has a next step — a workflow finish ends the run",
    });
  });

  it("a path that never reaches a workflow finish is a dead end", () => {
    expect(violationsOf([from(Start).next(A)]).violations[0]?.message).toBe(
      "A has no next step and is not a workflow finish",
    );
  });

  it("a workflow start and a workflow finish may share a name; two starts may not", () => {
    const model = checkFlow([from(StartNamedDone).next(A), from(A).next(Done)]);

    expect([...model.nodes.keys()]).toEqual(["workflow-start.done", "a", "done"]);
    expect(codesOf([from(Start, AlsoNamedStart).next(A), from(A).next(Done)])).toContain(
      "graph.duplicate-node",
    );
  });
});

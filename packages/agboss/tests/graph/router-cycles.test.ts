import { describe, expect, it } from "vitest";
import { checkFlow } from "../../src/graph/check-flow.js";
import { from, Self, type Flow } from "../../src/graph/flow.js";
import { GraphRuleError, type RuleViolation } from "../../src/graph/rule-error.js";
import { codeReviewFlow } from "./fixtures/code-review.js";
import { jobScoutFlow } from "./fixtures/job-scout-shape.js";
import {
  A,
  B,
  Done,
  Gate,
  Loop,
  Only,
  Pick,
  Ping,
  Pong,
  Second,
  Start,
  UnboundedGate,
} from "./fixtures/rule-nodes.js";

function violationsOf(flow: Flow): readonly RuleViolation[] {
  try {
    checkFlow(flow);
  } catch (error) {
    if (error instanceof GraphRuleError) return error.violations;
    throw error;
  }
  return [];
}

const unbounded = (flow: Flow): readonly RuleViolation[] =>
  violationsOf(flow).filter((item) => item.code === "router.unbounded-cycle");

describe("#142 AC1: a router on a cycle without maxVisits → router.unbounded-cycle", () => {
  it("names the router and one cycle through it", () => {
    const flow: Flow = [from(Start).next(Loop), from(Loop).routes(), from(A).next(Loop)];

    expect(unbounded(flow)).toEqual([
      {
        code: "router.unbounded-cycle",
        message: "Loop is on a cycle (Loop → A → Loop) but has no maxVisits",
        nodes: ["Loop", "A"],
      },
    ]);
  });

  it("is reported together with the other violations", () => {
    const flow: Flow = [
      from(Start).next(Loop),
      from(Loop).routes(),
      from(A).next(Loop),
      from(B).next(Done),
    ];

    expect(violationsOf(flow).map((item) => item.code)).toEqual([
      "graph.unreachable-node",
      "router.unbounded-cycle",
    ]);
  });

  it("two routers on one cycle: both need maxVisits", () => {
    const flow: Flow = [
      from(Start).next(Ping),
      from(Ping).routes(),
      from(A).next(Pong),
      from(Pong).routes(),
      from(B).next(Ping),
    ];

    expect(unbounded(flow).map((item) => item.message)).toEqual([
      "Ping is on a cycle (Ping → A → Pong → B → Ping) but has no maxVisits",
      "Pong is on a cycle (Pong → B → Ping → A → Pong) but has no maxVisits",
    ]);
  });

  it("a self-loop via route(Self) is a cycle with the agent before the router", () => {
    const flow: Flow = [
      from(Start).next(A),
      from(A).next(UnboundedGate),
      from(UnboundedGate).routes(),
    ];

    expect(unbounded(flow).map((item) => item.message)).toEqual([
      "UnboundedGate is on a cycle (UnboundedGate → A → UnboundedGate) but has no maxVisits",
    ]);
  });
});

describe("#142 AC2: a router not on a cycle may omit maxVisits", () => {
  it("routers only on a path assemble without maxVisits", () => {
    const flow: Flow = [
      from(Start).next(Second),
      from(Second).routes(),
      from(A).next(Only),
      from(Only).routes(),
    ];

    expect(checkFlow(flow).nodes.size).toBe(5);
  });

  it("Self after a workflow start is not a cycle", () => {
    expect(unbounded([from(Start).next(UnboundedGate), from(UnboundedGate).routes()])).toEqual([]);
  });

  it("bounded cycles assemble: the job-scout star, the code-review gate, Self with maxVisits", () => {
    const selfGate: Flow = [
      from(Start).next(Pick),
      from(Pick).routes(),
      from(A, B).next(Gate),
      from(Gate).routes(),
    ];

    expect(checkFlow(jobScoutFlow).nodes.size).toBe(6);
    expect(checkFlow(codeReviewFlow).nodes.size).toBe(8);
    expect(checkFlow(selfGate).nodes.size).toBe(6);
  });
});

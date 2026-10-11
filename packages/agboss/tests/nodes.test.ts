import { describe, expect, it, vi } from "vitest";
import { AFTER_APPROVAL_DECISION, makeFlowRouterNode } from "../src/graph/nodes/flow-router.js";
import type { RouteOutcome, RouteRequest } from "../src/routers/index.js";
import { testRouters } from "./fixtures/test-flow/test.flow.js";
import { flowState } from "./helpers.js";

describe("after a human decision the turn ends (#100)", () => {
  const [loaded] = testRouters;
  if (loaded === undefined) throw new Error("test router missing");
  const routerNode = () => {
    const route = vi.fn<(request: RouteRequest) => Promise<RouteOutcome>>(() =>
      Promise.resolve({ kind: "decided", decision: { next: "alpha", reason: "again" } }),
    );
    const node = makeFlowRouterNode({
      router: { name: "main", route },
      loaded,
      memory: { summaries: 0, turns: 0 },
      finish: "replyWith",
    });
    return { node, route };
  };
  const decision = (approved: boolean) => ({
    agent: "alpha",
    tool: "note_save",
    args: { text: "x" },
    approved,
    by: "tester",
    result: approved ? "{}" : "Tool error: the call was rejected by tester",
  });
  const answered = [{ agent: "alpha", content: "not saved" }];

  it("AC1 (#100): after a rejected call and the agent's replyWith — the replyWith, the router is not asked", async () => {
    const { node, route } = routerNode();

    const update = await node(flowState({ contributions: answered, approvals: [decision(false)] }));

    expect(update).toEqual({ next: "replyWith", routeReason: AFTER_APPROVAL_DECISION });
    expect(route).not.toHaveBeenCalled();
  });

  it("AC2 (#100): after an approved call and the agent's replyWith — the same", async () => {
    const { node, route } = routerNode();

    expect(
      await node(flowState({ contributions: answered, approvals: [decision(true)] })),
    ).toMatchObject({ next: "replyWith" });
    expect(route).not.toHaveBeenCalled();
  });

  it("AC3 (#100): without human decisions the router decides as before", async () => {
    const { node, route } = routerNode();

    expect(await node(flowState({ contributions: answered }))).toMatchObject({
      next: "alpha",
      routeReason: "again",
    });
    expect(route).toHaveBeenCalledTimes(1);
  });
});

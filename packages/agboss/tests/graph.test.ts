import { describe, expect, it } from "vitest";
import { MissingAgentPromptError } from "../src/graph/agent-definitions.js";
import { flowGraphOf, type RunLimits } from "../src/graph/flow-runtime.js";
import { LimitExceededError } from "../src/graph/limits.js";
import { routeTo, fakeDeps, testLimits } from "./helpers.js";

const run: RunLimits = { limits: testLimits, spentToday: () => Promise.resolve(0) };

describe("the workflow's flow graph (existing nodes in the new graph)", () => {
  it("routes through agents and ends at the replyWith with the last contribution", async () => {
    const deps = fakeDeps({
      "test/router": [routeTo("alpha"), routeTo("beta"), routeTo("replyWith", "done")],
      "test/alpha": ["facts"],
      "test/beta": ["code"],
    });
    const { graph } = await flowGraphOf(deps, run);

    const state = await graph.invoke({ task: "Explain and implement" });

    expect(state.contributions.map((item) => item.agent)).toEqual(["alpha", "beta"]);
    expect(state.replyWith).toBe("code");
    expect(state.routeReason).toBe("done");
    expect(state.path).toEqual([
      "workflow-start.chat",
      "main",
      "alpha",
      "main",
      "beta",
      "main",
      "replyWith",
    ]);
    expect(state.usage.map((record) => record.caller)).toEqual([
      "router:main",
      "alpha",
      "router:main",
      "beta",
      "router:main",
    ]);
  });

  it("fails the run with limits.perRun.steps when the router keeps routing", async () => {
    const deps = fakeDeps({
      "test/router": Array.from({ length: 6 }, () => routeTo("alpha")),
      "test/alpha": ["1", "2", "3", "4", "5", "6"],
    });
    const { graph } = await flowGraphOf(deps, run);

    const failure = graph.invoke({ task: "Loop" });

    await expect(failure).rejects.toBeInstanceOf(LimitExceededError);
    await expect(failure).rejects.toMatchObject({ key: "limits.perRun.steps", limit: 9 });
  });

  it("fails fast when an agent has no prompt", async () => {
    const deps = { ...fakeDeps({}), prompts: { alpha: "only alpha" } };

    // @ts-expect-error — the type system already forbids a missing prompt; this checks runtime too
    await expect(flowGraphOf(deps, run)).rejects.toBeInstanceOf(MissingAgentPromptError);
  });
});

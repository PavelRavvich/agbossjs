import { describe, expect, it } from "vitest";
import { SlidingWindowStrategy, type MemoryContext } from "../../src/memory/index.js";

const turn = (task: string) => ({ task, replyWith: `re ${task}`, status: "answered" });

const context = (limits: MemoryContext["limits"]): MemoryContext => ({
  agent: "a",
  task: "now",
  history: ["t1", "t2", "t3"].map(turn),
  summaries: ["s1", "s2"],
  limits,
});

describe("SlidingWindowStrategy", () => {
  it("keeps the agent's configured number of last turns and summaries", () => {
    const view = new SlidingWindowStrategy().buildContext(context({ turns: 2, summaries: 1 }));

    expect(view).toEqual({ history: [turn("t2"), turn("t3")], summaries: ["s2"] });
  });

  it("a limit of 0 shows nothing", () => {
    expect(new SlidingWindowStrategy().buildContext(context({ turns: 0, summaries: 0 }))).toEqual({
      history: [],
      summaries: [],
    });
  });

  it("a fixed window overrides the configured limits", () => {
    const view = new SlidingWindowStrategy({ turns: 1 }).buildContext(
      context({ turns: 3, summaries: 2 }),
    );

    expect(view).toEqual({ history: [turn("t3")], summaries: ["s1", "s2"] });
  });
});

import { describe, expect, it } from "vitest";
import { runAgent } from "../../src/index.js";
import { routeTo, fakeDeps, memoryLedger } from "../helpers.js";

describe("runAgent writes Terns", () => {
  it("records an answered run with route, steps, cost and versions", async () => {
    const deps = fakeDeps({
      "test/router": [routeTo("alpha"), routeTo("replyWith", "done")],
      "test/alpha": ["42"],
    });

    const result = await runAgent({ task: "Answer" }, deps);

    const [tern] = await deps.terns.byIds([result.ternId]);
    expect(tern).toMatchObject({
      threadId: result.threadId,
      task: "Answer",
      replyWith: "42",
      status: "answered",
      stopReason: "done",
      route: ["alpha"],
      steps: [{ agent: "alpha", content: "42" }],
      replayOf: null,
    });
  });

  it("records a failed run too", async () => {
    const deps = fakeDeps({}, memoryLedger(10));

    await expect(runAgent({ task: "Anything" }, deps)).rejects.toThrow();

    const [tern] = await deps.terns.unscored("test-bundle", undefined, 10);
    expect(tern).toBeUndefined();
    expect((await deps.terns.summary("test-bundle"))[0]).toMatchObject({ terns: 1, scored: 0 });
  });
});

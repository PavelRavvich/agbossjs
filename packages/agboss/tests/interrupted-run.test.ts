import { describe, expect, it } from "vitest";
import { runAgent } from "../src/index.js";
import { routeTo, fakeDeps } from "./helpers.js";

describe("interrupted runs", () => {
  it("an aborted signal stops the run and stores an interrupted Tern", async () => {
    const deps = fakeDeps({
      "test/router": [routeTo("alpha"), routeTo("replyWith")],
      "test/alpha": ["ok"],
    });
    const controller = new AbortController();
    controller.abort();

    await expect(runAgent({ task: "Hi" }, deps, { signal: controller.signal })).rejects.toThrow(
      "the run was cancelled",
    );

    expect((await deps.terns.summary("test-bundle"))[0]).toMatchObject({ terns: 1 });
  });
});

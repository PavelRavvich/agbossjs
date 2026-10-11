import { describe, expect, it } from "vitest";
import { LimitExceededError } from "../../src/graph/limits.js";
import { RouterDecisionError } from "../../src/graph/nodes/flow-router.js";
import { runAgent } from "../../src/index.js";
import { routeTo } from "../helpers.js";
import { jobScoutDeps } from "../graph/fixtures/job-scout-shape.js";

describe("AC1: a limit or a router failure fails the run and is a failed Tern", () => {
  it("routers.main.maxVisits: the 4th visit of the main router fails, with the path and the spend", async () => {
    const { deps, ledger } = jobScoutDeps({
      router: [routeTo("profiler"), routeTo("scout"), routeTo("shortlist")],
      agents: { profiler: ["p"], scout: ["s"], shortlist: ["l"] },
    });

    const threadId = await deps.terns.createThread("job-scout");

    const failure = runAgent({ task: "everything at once", threadId }, deps);

    await expect(failure).rejects.toBeInstanceOf(LimitExceededError);
    await expect(failure).rejects.toMatchObject({
      key: "routers.main.maxVisits",
      limit: 3,
      path: [
        "workflow-start.chat",
        "main",
        "profiler",
        "main",
        "scout",
        "main",
        "shortlist",
        "main",
      ],
    });
    const [tern] = await deps.terns.lastTerns(threadId, 1);
    expect(tern).toMatchObject({ status: "failed", task: "everything at once" });
    expect(tern?.stopReason).toContain("routers.main.maxVisits");
    expect(tern?.costUsd).toBeGreaterThan(0);
    expect(ledger.recorded.map((record) => record.caller)).toEqual([
      "router:main",
      "profiler",
      "router:main",
      "scout",
      "router:main",
      "shortlist",
    ]);
  });

  it("router.unknown-route: a choice that is not a route fails the run; its call is still billed", async () => {
    const { deps, ledger } = jobScoutDeps({ router: [routeTo("recruiter")], agents: {} });

    const threadId = await deps.terns.createThread("job-scout");

    const failure = runAgent({ task: "call a recruiter", threadId }, deps);

    await expect(failure).rejects.toBeInstanceOf(RouterDecisionError);
    await expect(failure).rejects.toMatchObject({ code: "router.unknown-route", router: "main" });
    const [tern] = await deps.terns.lastTerns(threadId, 1);
    expect(tern?.status).toBe("failed");
    expect(tern?.stopReason).toContain("router.unknown-route");
    expect(ledger.recorded.map((record) => record.caller)).toEqual(["router:main"]);
  });
});

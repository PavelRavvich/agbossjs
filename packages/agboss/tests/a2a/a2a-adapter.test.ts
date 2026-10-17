import { describe, expect, it } from "vitest";
import { eventOf, failureStatusOf, statusOf } from "../../src/a2a/a2a-mapping.js";
import { LimitExceededError } from "../../src/graph/limits.js";
import { A2AStatus } from "../../src/a2a/types.js";
import { ExecutionStatus } from "../../src/app/types.js";

describe("A2A status and event mapping", () => {
  it("every run status maps to its own A2A status", () => {
    expect([ExecutionStatus.Finished, ExecutionStatus.Paused].map(statusOf)).toEqual([
      A2AStatus.Finished,
      A2AStatus.Paused,
    ]);
  });

  it("a thrown run is cancelled when its signal aborted, limited on a limit, else failed", () => {
    const aborted = AbortSignal.abort();
    const live = new AbortController().signal;
    const limit = new LimitExceededError(
      { key: "limits.perRun.cost", limit: 1, actual: 2 },
      [],
      2,
      [],
    );

    expect(failureStatusOf(new Error("x"), aborted)).toBe(A2AStatus.Cancelled);
    expect(failureStatusOf(limit, live)).toBe(A2AStatus.Limited);
    expect(failureStatusOf(new Error("x"), live)).toBe(A2AStatus.Failed);
  });

  it("text deltas and tool calls become progress events", () => {
    expect(eventOf({ kind: "textDelta", delta: "Hel" })).toEqual({
      type: "progress",
      payload: { step: "text", content: "Hel" },
    });
    expect(eventOf({ kind: "toolCall", tool: "lookup" })).toEqual({
      type: "progress",
      payload: { step: "tool", content: "lookup" },
    });
  });
});

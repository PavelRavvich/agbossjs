import { describe, expect, it } from "vitest";
import {
  replyWith,
  callTools,
  harness,
  read,
  runLoop,
  startInput,
  stateOf,
  toolMessagesOf,
  wait,
} from "./fixtures.js";

describe("AC3: parallel calls in one turn run concurrently; results keep the call order", () => {
  it("finishes in completion order but hands the results to the model in call order", async () => {
    const h = harness({
      moves: [callTools(wait("slow", 60), wait("fast", 1), wait("mid", 30)), replyWith("ok")],
    });

    await runLoop(h.graph, startInput(), "t");

    expect(h.effects).toEqual(["waited 1", "waited 30", "waited 60"]);
    expect(toolMessagesOf(h.model.sent[1]).map(([callId]) => callId)).toEqual([
      "slow",
      "fast",
      "mid",
    ]);
    expect(Object.keys((await stateOf(h.graph, "t")).results).sort()).toEqual([
      "fast",
      "mid",
      "slow",
    ]);
  });

  it("the same tool asked twice in one turn runs twice, each result under its own callId", async () => {
    const h = harness({
      moves: [callTools(read("a", "x.ts"), read("b", "x.ts")), replyWith("ok")],
    });

    await runLoop(h.graph, startInput(), "t");

    expect(h.effects).toEqual(["read x.ts", "read x.ts"]);
    expect(toolMessagesOf(h.model.sent[1])).toEqual([
      ["a", "contents of x.ts"],
      ["b", "contents of x.ts"],
    ]);
  });
});

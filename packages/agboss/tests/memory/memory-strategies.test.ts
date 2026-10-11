import { beforeEach, describe, expect, it } from "vitest";
import type { Class } from "../../src/components/injection.js";
import { workflowOf } from "../../src/components/assemble.js";
import { Agent, Workflow, chain, WorkflowSettings } from "../../src/index.js";
import { replyWith, testWith, type ModelScript } from "../../src/testing/index.js";
import type { TestApp } from "../../src/testing/test-app.js";
import { usd } from "../../src/units/index.js";
import type { BaseMemoryStrategy } from "../../src/memory/index.js";
import {
  Answer,
  CompactingDesk,
  MemoryDesk,
  NOTED,
  Noter,
  Recaller,
  TaskStart,
  Windowed,
} from "./fixtures/memory.workflow.js";

/** The text input of the model's last request. */
const inputOf = (script: ModelScript): string => {
  const request = script.lastRequest;
  if (request.kind !== "chat") return "";
  return typeof request.input === "string" ? request.input : JSON.stringify(request.input);
};

/** The earlier turns ("Q: …") the model saw in its last request's input. */
const turnsSeen = (script: ModelScript): string[] =>
  [...inputOf(script).matchAll(/^Q: (.+)$/gmu)].map((match) => match[1] ?? "");

/** `count` turns on one thread: t1, t2, …; returns the last result. */
async function converse(app: TestApp, count: number) {
  let result = await app.execute(TaskStart, { text: "t1" });
  for (let turn = 2; turn <= count; turn++) {
    result = await app.execute(TaskStart, { text: `t${String(turn)}` }, { thread: result.thread });
  }
  return result;
}

describe("memory strategies on agent model calls", () => {
  const test = testWith(MemoryDesk);
  beforeEach(() => {
    NOTED.length = 0;
  });

  test("AC1: with a sliding window of N, the model request holds at most N earlier turns", async ({
    app,
    mockLlm,
  }) => {
    for (const agent of [Recaller, Windowed, Noter])
      mockLlm(agent).thenReturnAlways(replyWith("ok"));

    await converse(app, 6);

    expect(turnsSeen(mockLlm(Windowed))).toEqual(["t4", "t5"]);
  });

  test("an agent's own strategy is used for that agent only; the others keep the workflow's default", async ({
    app,
    mockLlm,
  }) => {
    for (const agent of [Recaller, Windowed, Noter])
      mockLlm(agent).thenReturnAlways(replyWith("ok"));

    await converse(app, 6);

    expect(turnsSeen(mockLlm(Noter))).toEqual(["t5"]);
    expect(turnsSeen(mockLlm(Recaller))).toEqual(["t2", "t3", "t4", "t5"]);
  });

  test("after every finished turn the strategy updates its memory (created by the container, with its deps)", async ({
    app,
    mockLlm,
  }) => {
    for (const agent of [Recaller, Windowed, Noter])
      mockLlm(agent).thenReturnAlways(replyWith("ok"));

    await converse(app, 3);

    expect(NOTED).toEqual(["t1", "t2", "t3"]);
  });
});

describe("compaction is the built-in strategy's memory update", () => {
  const test = testWith(CompactingDesk);

  test("AC2: compaction cost is recorded in the run's cost report", async ({
    app,
    mockLlm,
    mockCompaction,
  }) => {
    mockLlm(Recaller).thenReturnAlways(replyWith("ok", { cost: usd(0.001) }));
    mockCompaction().thenReturnAlways(replyWith("t1 and t2 were asked", { cost: usd(0.004) }));

    const second = await converse(app, 2);

    expect(second.compacted).toMatchObject({ fromTurn: 1, toTurn: 2, summaries: 1 });
    expect(second.spend.byCategory.compaction).toBeCloseTo(0.004, 6);
    expect(second.spend.totalUsd).toBeCloseTo(0.005, 6);
    expect(second.spend.trace.map((line) => line.caller)).toEqual(["recaller", "compaction"]);
  });

  test("agents then see the summary and the turns not yet compacted", async ({
    app,
    mockLlm,
    mockCompaction,
  }) => {
    mockLlm(Recaller).thenReturnAlways(replyWith("ok"));
    mockCompaction().thenReturnAlways(replyWith("t1 and t2 were asked"));

    await converse(app, 4);

    expect(inputOf(mockLlm(Recaller))).toContain(
      "Earlier in this conversation:\n[1] t1 and t2 were asked",
    );
    expect(turnsSeen(mockLlm(Recaller))).toEqual(["t3"]);
  });
});

class NotAStrategy {
  readonly kind = "not a strategy";
}
const notAStrategy: Class = NotAStrategy;

@Agent({
  name: "odd",
  prompt: "Odd.",
  description: "Has a class that is no strategy",
  model: "local/llama",
  memoryStrategy: notAStrategy as Class<BaseMemoryStrategy>,
})
class Odd {}

@Workflow({
  name: "odd-desk",
  version: "1.0.0",
  flow: [chain(TaskStart, Odd, Answer)],
  defaults: {
    models: { temperature: 0 },
    router: { kind: "jev", model: "typesafe/jev-1.13" },
    history: { limit: 1 },
  },
})
class OddDesk {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder().build();
  }
}

describe("assembly", () => {
  it("a memoryStrategy that does not extend BaseMemoryStrategy fails assembly", async () => {
    await expect(workflowOf(OddDesk)).rejects.toThrow("[memory.not-a-strategy]");
  });
});

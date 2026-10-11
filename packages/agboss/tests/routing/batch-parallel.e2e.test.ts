import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app/create-app.js";
import { GraphRuleError } from "../../src/index.js";
import { checkFlow } from "../../src/graph/check-flow.js";
import { callTool, replyWith, testWith, type ModelRequest } from "../../src/testing/index.js";
import {
  BadBatch,
  batchFlow,
  CityGuide,
  Clerk,
  Done,
  Editor,
  FileItem,
  Filings,
  Guide,
  ItemsStart,
  PlainStrategy,
  tallied,
  TallyPairs,
  TallyWords,
} from "./fixtures/batch.workflow.js";

const systemOf = (request: ModelRequest): string => (request.kind === "chat" ? request.system : "");
const hasToolResult = (request: ModelRequest): boolean =>
  request.kind === "chat" && request.messages.some((line) => line.role === "tool");

const guide = testWith(CityGuide);
const tally = testWith(TallyWords);
const filing = testWith(Filings);
const pairs = testWith(TallyPairs);
const approve = { approved: true, by: "dana" };

describe("#186 AC1: batchParallel maps an agent over the items", () => {
  guide("each Guide run gets its own item as {{item}} in its prompt", async ({ app, mockLlm }) => {
    mockLlm(Guide).thenAnswer((request) => replyWith(`line for ${systemOf(request).slice(-20)}`));
    mockLlm(Editor).thenReturn(replyWith("three lines"));

    const result = await app.execute(ItemsStart, { text: "Haifa, Akko, Tzfat" });

    const prompts = mockLlm(Guide).requests.map(systemOf);
    expect(prompts).toHaveLength(3);
    for (const city of ["Haifa", "Akko", "Tzfat"]) {
      const json = JSON.stringify({ city }, null, 2);
      expect(prompts.filter((prompt) => prompt.includes(json))).toHaveLength(1);
    }
    expect(mockLlm(Editor).requests).toHaveLength(1);
    expect(result).toFinishWith(Done, { text: "three lines" });
  });

  guide("a second run on the thread extracts its items again", async ({ app, mockLlm }) => {
    mockLlm(Guide).thenAnswer(() => replyWith("line"));
    mockLlm(Editor).thenReturn(replyWith("first"), replyWith("second"));

    const first = await app.execute(ItemsStart, { text: "Haifa, Akko" });
    await app.execute(ItemsStart, { text: "Eilat" }, { thread: first.thread });

    const prompts = mockLlm(Guide).requests.map(systemOf);
    expect(prompts).toHaveLength(3);
    expect(prompts[2]).toContain('"city": "Eilat"');
  });
});

describe("#186 AC2: batchParallel maps an action, and a paused batch resumes", () => {
  tally("each Tally run sees its item as context.item", async ({ app, mockLlm }) => {
    tallied.length = 0;
    mockLlm(Editor).thenReturn(replyWith("three words"));

    const result = await app.execute(ItemsStart, { text: "red, green, blue" });

    expect([...tallied].sort()).toEqual(["blue", "green", "red"]);
    expect(result).toFinishWith(Done, { text: "three words" });
  });

  pairs("with batchSize 2 each run's item is its batch of items", async ({ app, mockLlm }) => {
    tallied.length = 0;
    mockLlm(Editor).thenReturn(replyWith("two batches"));

    await app.execute(ItemsStart, { text: "a, b, c" });

    expect(tallied).toEqual([["a", "b"], ["c"]]);
  });

  filing(
    "a worker paused for approval resumes after recoverApp; finished items do not rerun",
    async ({ app, recoverApp, mockLlm }) => {
      mockLlm(Clerk).thenAnswer((request) =>
        systemOf(request).includes("File this item: b") && !hasToolResult(request)
          ? callTool(FileItem, { text: "b" })
          : replyWith("filed"),
      );

      const paused = await app.execute(ItemsStart, { text: "a, b, c" });
      const restarted = await recoverApp();
      const done = await restarted.resume(paused.thread, approve);

      expect(paused).toHavePausedAt(Clerk);
      expect(done).toFinishWith(Done, { text: "filed" });
      const items = mockLlm(Clerk).requests.map((request) => systemOf(request).slice(-1));
      expect(items).toEqual(["a", "b", "b", "c"]);
    },
  );
});

describe("#186 AC3: invalid batch options fail at assembly with a named rule", () => {
  const codesOf = (flow: Parameters<typeof checkFlow>[0]): string[] => {
    try {
      checkFlow(flow);
      return [];
    } catch (error) {
      return error instanceof GraphRuleError ? error.violations.map((v) => v.code) : [];
    }
  };

  it("batchSize and concurrencyLimit below 1, or not whole numbers, are rejected", () => {
    expect(codesOf(batchFlow({ concurrencyLimit: 1, batchSize: 0 }))).toEqual([
      "batch.invalid-batch-size",
    ]);
    expect(codesOf(batchFlow({ concurrencyLimit: 0, batchSize: 1 }))).toEqual([
      "batch.invalid-concurrency-limit",
    ]);
    expect(codesOf(batchFlow({ concurrencyLimit: 1.5, batchSize: 1 }))).toEqual([
      "batch.invalid-concurrency-limit",
    ]);
    expect(codesOf(batchFlow({ concurrencyLimit: 2, batchSize: 3 }))).toEqual([]);
  });

  it("a strategy without @BatchParallelStrategy is rejected", () => {
    expect(codesOf(batchFlow({ concurrencyLimit: 1, batchSize: 1 }, PlainStrategy))).toEqual([
      "batch.strategy-not-decorated",
    ]);
  });

  it("createApp refuses the workflow, naming every broken rule", async () => {
    const built = createApp(BadBatch, { processEnv: {} });

    await expect(built).rejects.toBeInstanceOf(GraphRuleError);
    const codes = await built.catch((error: unknown) =>
      error instanceof GraphRuleError ? error.violations.map((v) => v.code) : [],
    );
    expect(codes).toEqual(["batch.invalid-batch-size", "batch.strategy-not-decorated"]);
  });
});

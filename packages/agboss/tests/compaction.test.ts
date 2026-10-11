import { FakeListChatModel } from "@langchain/core/utils/testing";
import { describe, expect, it, vi } from "vitest";
import { runAgent, type RunDeps } from "../src/index.js";
import { createModelRegistry, type ModelFactory } from "../src/llm/registry.js";
import { compactIfDue } from "../src/run/compaction.js";
import { usd } from "../src/units/index.js";
import { ScriptedChatModel } from "./fakes/scripted-model.js";
import {
  routeTo,
  fakeDeps,
  memoryLedger,
  recordingRouters,
  testConfig,
  type TestAgent,
  fakeGateway,
} from "./helpers.js";

const price = testConfig.agents.alpha.price;

interface Setup {
  readonly every?: number;
  readonly keep?: number;
  readonly compactor?: ScriptedChatModel;
  readonly summaries?: {
    readonly defaults?: number;
    readonly alpha?: number;
  };
  readonly runBudgetCap?: number;
  readonly turns: number;
}

/** A thread of `turns` turns; alpha answers "a<n>", the compactor answers "S<n>". */
function setup({
  every = 5,
  keep = 10,
  compactor,
  summaries = {},
  runBudgetCap = 1,
  turns,
}: Setup) {
  const summariser =
    compactor ?? new ScriptedChatModel(Array.from({ length: 20 }, (_, i) => `S${String(i + 1)}`));
  const alpha = new ScriptedChatModel(Array.from({ length: turns }, (_, i) => `a${String(i + 1)}`));
  const factory = vi.fn<ModelFactory>((s) =>
    s.model === "test/compactor"
      ? summariser
      : s.model === "test/alpha"
        ? alpha
        : new FakeListChatModel({ responses: ["x"] }),
  );
  const config = {
    ...testConfig,
    defaults: {
      ...testConfig.defaults,
      history: {
        limit: 10,
        ...(summaries.defaults === undefined ? {} : { summaries: summaries.defaults }),
      },
    },
    agents: {
      ...testConfig.agents,
      alpha: {
        ...testConfig.agents.alpha,
        ...(summaries.alpha === undefined ? {} : { historySummaries: summaries.alpha }),
      },
    },
    compaction: { every, keep, model: { model: "test/compactor", price } },
  };
  const ledger = memoryLedger();
  const base = fakeDeps(
    {
      "test/router": Array.from({ length: turns + 2 }, () => [
        routeTo("alpha"),
        routeTo("replyWith", "done"),
      ]).flat(),
    },
    ledger,
  );
  const deps: RunDeps<TestAgent> = {
    ...base,
    config,
    limits: { perRun: { cost: usd(runBudgetCap) } },
    registry: createModelRegistry(config, fakeGateway(factory)),
  };
  return { deps, alpha, summariser, ledger };
}

async function converse(deps: RunDeps<TestAgent>, turns: number) {
  const results = [await runAgent({ task: "q1" }, deps)];
  for (let i = 2; i <= turns; i += 1) {
    const threadId = results[0]?.threadId ?? "";
    results.push(await runAgent({ task: `q${String(i)}`, threadId }, deps));
  }
  return results;
}

const lastHuman = (model: ScriptedChatModel): string =>
  model.sent.at(-1)?.findLast((m) => m.type === "human")?.text ?? "";

describe("conversation compaction", () => {
  it("AC2: compacts every N turns, right after the turn, and says so", async () => {
    const { deps } = setup({ turns: 6 });

    const results = await converse(deps, 6);

    expect(results.slice(0, 4).every((r) => r.compacted === undefined)).toBe(true);
    expect(results[4]?.compacted).toEqual({ fromTurn: 1, toTurn: 5, summaries: 1, keep: 10 });
    expect(results[4]?.cost.byCategory.compaction).toBeGreaterThan(0);
    expect(results[5]?.compacted).toBeUndefined();
  });

  it("AC1, AC3: the compactor sees its own turns plus the previous raw window, never a summary", async () => {
    const { deps, summariser } = setup({ every: 2, turns: 4 });

    await converse(deps, 4);

    const second = summariser.sent[1]?.findLast((m) => m.type === "human")?.text ?? "";
    expect(second).toContain("Earlier turns (context only):\nQ: q1\nA: a1\n\nQ: q2\nA: a2");
    expect(second).toContain("Turns to compact:\nQ: q3\nA: a3\n\nQ: q4\nA: a4");
    expect(second).not.toContain("S1");
  });

  it("AC1: later turns see the summary and only the raw turns since", async () => {
    const { deps, alpha } = setup({ every: 2, turns: 4 });

    await converse(deps, 4);

    const input = lastHuman(alpha);
    expect(input).toContain("Earlier in this conversation:\n[1] S1");
    expect(input).toContain("Q: q3\nA: a3");
    expect(input).not.toContain("Q: q1");
  });

  it("AC3: a full queue drops the oldest summary from the context; rows stay", async () => {
    const { deps, alpha } = setup({ every: 2, keep: 2, turns: 7 });

    const results = await converse(deps, 7);

    const input = lastHuman(alpha);
    expect(input).toContain("[1] S2");
    expect(input).toContain("[2] S3");
    expect(input).not.toContain("S1");
    expect(await deps.terns.summaryCount(results[0]?.threadId ?? "")).toBe(3);
  });

  it("AC4: each reader sees its own number of summaries (0 = none)", async () => {
    const { deps: base, alpha } = setup({
      every: 2,
      turns: 5,
      summaries: { defaults: 0, alpha: 1 },
    });
    const { deps, requests } = recordingRouters(base);

    await converse(deps, 5);

    const agentInput = lastHuman(alpha);
    expect(agentInput).toContain("[1] S2");
    expect(agentInput).not.toContain("S1");
    expect(requests.at(-1)?.input).not.toContain("Earlier in this conversation");
  });

  it("AC5: a compaction failure never fails the turn; the next turn retries", async () => {
    const broken = new ScriptedChatModel([]);
    vi.spyOn(broken, "invoke")
      .mockRejectedValueOnce(new Error("model down"))
      .mockResolvedValueOnce(Object.assign(await new ScriptedChatModel(["S1"]).invoke("x"), {}));
    const { deps } = setup({ every: 2, turns: 3, compactor: broken });

    const results = await converse(deps, 3);

    expect(results[1]?.replyWith).toBe("a2");
    expect(results[1]?.compacted).toBeUndefined();
    expect(results[2]?.compacted).toMatchObject({ fromTurn: 1, toTurn: 2 });
  });

  it("AC5: no compaction when the turn's budget is spent", async () => {
    const { deps, summariser } = setup({ every: 3, turns: 2 });
    const [first] = await converse(deps, 2);
    const compaction = { every: 2, keep: 10, model: { model: "test/compactor", price } };
    const due = { ...deps, config: { ...deps.config, compaction } };
    const threadId = first?.threadId ?? "";

    const spent = await compactIfDue(due, { threadId, budgetLeftUsd: 0, callbacks: [] });
    const funded = await compactIfDue(due, { threadId, budgetLeftUsd: 1, callbacks: [] });

    expect(spent.compacted).toBeUndefined();
    expect(funded.compacted).toMatchObject({ fromTurn: 1, toTurn: 2 });
    expect(summariser.sent).toHaveLength(1);
  });

  it("AC6: without compaction configured nothing changes", async () => {
    const { deps } = setup({ turns: 1 });
    const plain = { ...deps, config: { ...deps.config, compaction: undefined } };

    const [result] = await converse(plain, 1);

    expect(result?.compacted).toBeUndefined();
  });
});

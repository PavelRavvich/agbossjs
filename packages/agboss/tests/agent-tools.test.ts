import { FakeListChatModel } from "@langchain/core/utils/testing";
import { describe, expect, it } from "vitest";
import type { AgentsConfigOf } from "../src/config/types.js";
import { LimitExceededError } from "../src/graph/limits.js";
import { runAgent, type RunDeps } from "../src/index.js";
import { createModelRegistry } from "../src/llm/registry.js";
import { NO_GUARDS } from "../src/guards/index.js";
import { createSqliteTernStore } from "../src/terns/index.js";
import { defineTool } from "../src/tools/index.js";
import { z } from "zod";
import { ScriptedChatModel, type Reply } from "./fakes/scripted-model.js";
import { usd } from "../src/units/index.js";
import {
  routeTo,
  flowDeps,
  memoryLedger,
  testConfig,
  type TestAgent,
  libraryTool,
  fakeGateway,
} from "./helpers.js";

interface Setup {
  readonly routes: string[];
  readonly alpha: readonly Reply[];
  readonly maxToolCalls?: number;
  readonly runBudgetCap?: number;
  readonly toolCostUsd?: number;
}

/** A paid tool: reports `costUsd` on every call. */
const paidSearch = (costUsd: number) =>
  defineTool({
    name: "paid_search",
    description: "Paid search",
    input: z.object({}),
    output: z.string(),
    run: (_input, ctx) => {
      ctx.reportCost(costUsd);
      return Promise.resolve("3 results");
    },
  });

function setup({ routes, alpha, maxToolCalls = 3, runBudgetCap = 1, toolCostUsd = 0.01 }: Setup) {
  const model = new ScriptedChatModel(alpha);
  const ledger = memoryLedger();
  const config: AgentsConfigOf<TestAgent> = {
    ...testConfig,
    agents: {
      ...testConfig.agents,
      alpha: { ...testConfig.agents.alpha, tools: ["current_time", "paid_search"], maxToolCalls },
    },
  };
  const router = new FakeListChatModel({ responses: routes });
  const deps: RunDeps<TestAgent> = {
    config,
    registry: createModelRegistry(
      config,
      fakeGateway((settings) =>
        settings.model === "test/alpha" ? model : new FakeListChatModel({ responses: ["beta"] }),
      ),
    ),
    ...flowDeps(() => router, {
      perRun: { cost: usd(runBudgetCap) },
      perDay: { cost: usd(10) },
    }),
    prompts: { alpha: async () => "You are alpha.", beta: async () => "You are beta." },
    terns: createSqliteTernStore(":memory:"),
    guards: NO_GUARDS,
    tools: (name) => (name === "paid_search" ? paidSearch(toolCostUsd) : libraryTool(name)),
    ledger,
  };
  return { deps, model, ledger };
}

const toTokyo: Reply = [{ tool: "current_time", args: { timeZone: "Asia/Tokyo" } }];
const answered = [routeTo("alpha"), routeTo("replyWith", "done")];

describe("agents with tools", () => {
  it("runs the model ↔ tool loop and answers", async () => {
    const { deps, model } = setup({
      routes: answered,
      alpha: [toTokyo, "It is evening in Tokyo."],
    });

    const result = await runAgent({ task: "Time in Tokyo?" }, deps);

    expect(result.replyWith).toBe("It is evening in Tokyo.");
    expect(model.sent[1]?.at(-1)?.text).toContain('"timeZone":"Asia/Tokyo"');
  });

  it("lets the model see tool errors", async () => {
    const { deps, model } = setup({
      routes: answered,
      alpha: [
        [{ tool: "current_time", args: { timeZone: "Mars/Olympus" } }],
        "Unknown zone, sorry.",
      ],
    });

    await runAgent({ task: "Time on Mars?" }, deps);

    expect(model.sent[1]?.at(-1)?.text).toContain("Tool error:");
  });

  it("records each model call of the loop", async () => {
    const { deps } = setup({ routes: answered, alpha: [toTokyo, "Done."] });

    const result = await runAgent({ task: "Time?" }, deps);

    expect(result.cost.byCaller.alpha).toBeCloseTo((2 * (100 * 3 + 20 * 6)) / 1_000_000);
  });

  it("handles two tool calls in one model reply", async () => {
    const both: Reply = [
      { tool: "current_time", args: { timeZone: "Asia/Tokyo" } },
      { tool: "current_time", args: { timeZone: "Europe/London" } },
    ];
    const { deps, model } = setup({ routes: answered, alpha: [both, "Both zones."] });

    const result = await runAgent({ task: "Tokyo and London?" }, deps);

    expect(result.replyWith).toBe("Both zones.");
    expect(model.sent[1]?.filter((message) => message.type === "tool")).toHaveLength(2);
  });

  it("#150 AC7: maxToolCalls from the config fails the run at agents.<name>.limits.toolCalls, the agent's spend recorded", async () => {
    const { deps, ledger } = setup({
      routes: answered,
      alpha: [toTokyo, toTokyo, "never"],
      maxToolCalls: 1,
    });

    const failure = await runAgent({ task: "Loop" }, deps).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LimitExceededError);
    expect(failure).toMatchObject({
      key: "agents.alpha.limits.toolCalls",
      limit: 1,
      actual: 2,
      path: ["workflow-start.chat", "main", "alpha"],
    });
    expect(ledger.recorded.filter((record) => record.caller === "alpha").length).toBeGreaterThan(0);
  });

  it("stops the loop when the run budget is spent; the run then fails at limits.perRun.cost", async () => {
    const { deps, model, ledger } = setup({
      routes: answered,
      alpha: [toTokyo, "never sent"],
      runBudgetCap: 0.0004,
    });

    const failure = runAgent({ task: "Time?" }, deps);

    await expect(failure).rejects.toMatchObject({
      key: "limits.perRun.cost",
      path: ["workflow-start.chat", "main", "alpha", "main"],
    });
    expect(model.sent).toHaveLength(1);
    expect(ledger.recorded.map((record) => record.caller)).toContain("alpha");
  });
});

const search: Reply = [{ tool: "paid_search", args: {} }];

describe("tool costs in FinOps", () => {
  it("reports tool costs separately", async () => {
    const { deps } = setup({ routes: answered, alpha: [search, "Found it."] });

    const result = await runAgent({ task: "Search" }, deps);

    expect(result.cost.byCaller["tool:paid_search"]).toBeCloseTo(0.01);
  });

  it("stops after a paid tool spends the run budget", async () => {
    const { deps, model } = setup({
      routes: answered,
      alpha: [search, "never sent"],
      runBudgetCap: 0.005,
    });

    await expect(runAgent({ task: "Search" }, deps)).rejects.toMatchObject({
      key: "limits.perRun.cost",
    });
    expect(model.sent).toHaveLength(1);
  });

  it("records tool spend of a failed agent", async () => {
    const { deps, ledger } = setup({
      routes: answered,
      alpha: [search, search, "never"],
      maxToolCalls: 1,
    });

    await expect(runAgent({ task: "Loop" }, deps)).rejects.toBeInstanceOf(LimitExceededError);
    expect(ledger.recorded.some((record) => record.caller === "tool:paid_search")).toBe(true);
  });

  it("turns an invalid reported cost into a tool error the model sees", async () => {
    const { deps, model } = setup({
      routes: answered,
      alpha: [search, "Handled."],
      toolCostUsd: -1,
    });

    const result = await runAgent({ task: "Search" }, deps);

    expect(model.sent[1]?.at(-1)?.text).toContain(
      'Tool error: Tool "paid_search" reported an invalid cost: -1',
    );
    expect(result.cost.byCaller["tool:paid_search"]).toBeUndefined();
  });
});

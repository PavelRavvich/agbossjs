import { describe, expect, it } from "vitest";
import {
  buildCostReport,
  costCategoryOf,
  costOf,
  extractTokenUsage,
  recordUsage,
  ZERO_USAGE,
  type UsageRecord,
} from "../src/finops/usage.js";
import { usageRecord as record } from "./helpers.js";

const price = { inputPerMTok: 2, outputPerMTok: 10 };
const settings = {
  model: "test/m",
  temperature: 0,
  maxTokens: 100,
  thinking: "default" as const,
  cache: true,
  timeoutMs: 1000,
  maxRetries: 0,
  price,
};

describe("finops usage", () => {
  it("computes cost from tokens and per-million prices", () => {
    expect(costOf({ ...ZERO_USAGE, inputTokens: 1_000_000, outputTokens: 500_000 }, price)).toBe(7);
  });

  it("prices cached input at cache rates, falling back to the input price", () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 600_000,
      cacheWriteTokens: 100_000,
    };
    const cachePrice = { ...price, cacheReadPerMTok: 0.5, cacheWritePerMTok: 2.5 };

    expect(costOf(usage, cachePrice)).toBeCloseTo(0.3 * 2 + 0.6 * 0.5 + 0.1 * 2.5);
    expect(costOf(usage, price)).toBeCloseTo(2);
  });

  it("treats a response without usage metadata as zero tokens", () => {
    expect(extractTokenUsage({})).toEqual(ZERO_USAGE);
  });

  it("records caller, model, tokens including cache and cost of a call", () => {
    const usage = {
      usage_metadata: {
        input_tokens: 1000,
        output_tokens: 200,
        input_token_details: { cache_read: 400, cache_creation: 0 },
      },
    };

    expect(recordUsage("coder", settings, usage)).toMatchObject({
      caller: "coder",
      model: "test/m",
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 400,
      costSource: "price-table",
    });
  });

  it("aggregates cost per caller and cached tokens", () => {
    const report = buildCostReport([
      record("router:main", 0.1),
      { ...record("coder", 0.2), cacheReadTokens: 50 },
      record("router:main", 0.1),
    ]);

    expect(report.calls).toBe(3);
    expect(report.totalUsd).toBeCloseTo(0.4);
    expect(report.cacheReadTokens).toBe(50);
    expect(report.byCaller).toEqual({ "router:main": 0.2, coder: 0.2 });
  });

  it("reports zero for a run without calls", () => {
    expect(buildCostReport([])).toEqual({
      totalUsd: 0,
      calls: 0,
      cacheReadTokens: 0,
      byCaller: {},
      byCategory: {
        agents: 0,
        routing: 0,
        guards: 0,
        review: 0,
        tools: 0,
        compaction: 0,
        retrieval: 0,
      },
      byModel: {},
      trace: [],
    });
  });
});

describe("turn financials", () => {
  const record = (caller: string, model: string, costUsd: number): UsageRecord => ({
    caller,
    model,
    costUsd,
    costSource: caller.startsWith("tool:") ? "tool" : "price-table",
    inputTokens: 10,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });

  it("categorises callers", () => {
    expect(costCategoryOf("tool:exchange_rate")).toBe("tools");
    expect(costCategoryOf("router:guard:pii")).toBe("guards");
    expect(costCategoryOf("router:quality:coder")).toBe("review");
    expect(costCategoryOf("compaction")).toBe("compaction");
    expect(costCategoryOf("router:main")).toBe("routing");
    expect(costCategoryOf("researcher")).toBe("agents");
  });

  it("reports categories, models and the call trace in order", () => {
    const report = buildCostReport([
      record("router:guard:prompt_injection", "jev", 0.00001),
      record("router:main", "jev", 0.00002),
      record("researcher", "kimi", 0.003),
      record("tool:exchange_rate", "exchange_rate", 0.001),
    ]);

    expect(report.byCategory).toEqual({
      agents: 0.003,
      routing: 0.00002,
      guards: 0.00001,
      review: 0,
      tools: 0.001,
      compaction: 0,
      retrieval: 0,
    });
    expect(report.byModel.jev).toBeCloseTo(0.00003);
    expect(report.trace.map((line) => [line.caller, line.category])).toEqual([
      ["router:guard:prompt_injection", "guards"],
      ["router:main", "routing"],
      ["researcher", "agents"],
      ["tool:exchange_rate", "tools"],
    ]);
    expect(Object.values(report.byCategory).reduce((a, b) => a + b, 0)).toBeCloseTo(
      report.totalUsd,
    );
  });
});

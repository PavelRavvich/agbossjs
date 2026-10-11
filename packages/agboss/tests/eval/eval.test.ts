import { describe, expect, it, vi } from "vitest";
import { evaluate, scoreOf, type EvalDeps } from "../../src/eval/eval.js";
import { runAgent } from "../../src/index.js";
import type { RouteOutcome, RouterEngine } from "../../src/routers/index.js";
import { routeTo, fakeDeps, memoryLedger, usageRecord } from "../helpers.js";

const judge = (...outcomes: RouteOutcome[]): RouterEngine => {
  const route = vi.fn<RouterEngine["route"]>();
  for (const outcome of outcomes) route.mockResolvedValueOnce(outcome);
  return { name: "judge", route };
};

const adequate = (confidence?: number): RouteOutcome => ({
  kind: "decided",
  decision: { next: "adequate", reason: "r", ...(confidence === undefined ? {} : { confidence }) },
  usage: usageRecord("router:judge", 0.001),
});

async function answeredRuns(count: number) {
  const script: Record<string, string[]> = { "test/router": [], "test/alpha": [] };
  for (let i = 0; i < count; i += 1) {
    script["test/router"]?.push(routeTo("alpha"), routeTo("replyWith", "done"));
    script["test/alpha"]?.push(`replyWith ${String(i)}`);
  }
  const deps = fakeDeps(script);
  for (let i = 0; i < count; i += 1) await runAgent({ task: `task ${String(i)}` }, deps);
  return deps;
}

describe("scoreOf", () => {
  it("is P(adequate)", () => {
    expect(scoreOf(adequate(0.9))).toBe(0.9);
    expect(scoreOf(adequate())).toBe(1);
    expect(
      scoreOf({ kind: "decided", decision: { next: "inadequate", reason: "", confidence: 0.8 } }),
    ).toBeCloseTo(0.2);
    expect(scoreOf({ kind: "failed", reason: "down" })).toBeUndefined();
  });
});

describe("evaluate", () => {
  it("scores unscored answered Terns and bills the eval account", async () => {
    const deps = await answeredRuns(2);
    const ledger = memoryLedger();
    const evaluation: EvalDeps = {
      terns: deps.terns,
      ledger,
      judge: judge(adequate(0.9), adequate(0.7)),
      account: { key: "test-bundle:eval", dailyCap: 5 },
    };

    const report = await evaluate(evaluation, "test-bundle", { limit: 10 });

    expect(report).toEqual({ scored: 2, costUsd: 0.002 });
    expect((await deps.terns.summary("test-bundle"))[0]?.meanScore).toBeCloseTo(0.8);
    expect(await evaluate(evaluation, "test-bundle", { limit: 10 })).toEqual({
      scored: 0,
      costUsd: 0,
    });
  });

  it("leaves a Tern unscored when the judge fails", async () => {
    const deps = await answeredRuns(1);
    const evaluation: EvalDeps = {
      terns: deps.terns,
      ledger: memoryLedger(),
      judge: judge({ kind: "failed", reason: "down" }),
      account: { key: "k", dailyCap: 5 },
    };

    expect(await evaluate(evaluation, "test-bundle", { limit: 10 })).toEqual({
      scored: 0,
      costUsd: 0,
    });
    expect(await deps.terns.unscored("test-bundle", undefined, 10)).toHaveLength(1);
  });

  it("stops when the eval budget is spent", async () => {
    const deps = await answeredRuns(1);
    const evaluation: EvalDeps = {
      terns: deps.terns,
      ledger: memoryLedger(5),
      judge: judge(adequate()),
      account: { key: "k", dailyCap: 5 },
    };

    expect(await evaluate(evaluation, "test-bundle", { limit: 10 })).toEqual({
      scored: 0,
      costUsd: 0,
      stoppedBy: "eval budget exhausted",
    });
  });
});

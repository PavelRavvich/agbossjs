import { describe, expect, it } from "vitest";
import { drainRecordingUsage, EmptyRunError, type HasUsage } from "../src/finops/record-stream.js";
import type { UsageRecord } from "../src/finops/usage.js";
import { usageRecord } from "./helpers.js";

async function* states(...items: HasUsage[]): AsyncGenerator<HasUsage> {
  for (const item of items) yield await Promise.resolve(item);
}

describe("drainRecordingUsage", () => {
  it("records each usage record exactly once, as soon as it appears", async () => {
    const batches: (readonly UsageRecord[])[] = [];
    const a = usageRecord("router:main", 0.1);
    const b = usageRecord("alpha", 0.2);

    const last = await drainRecordingUsage(
      states({ usage: [] }, { usage: [a] }, { usage: [a, b] }),
      (records) => {
        batches.push(records);
        return Promise.resolve();
      },
    );

    expect(batches.flat()).toEqual([a, b]);
    expect(last.usage).toEqual([a, b]);
  });

  it("fails on a run that produced no state", async () => {
    await expect(drainRecordingUsage(states(), () => Promise.resolve())).rejects.toBeInstanceOf(
      EmptyRunError,
    );
  });
});

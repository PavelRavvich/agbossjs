import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFileLedger, utcDay } from "../src/finops/ledger.js";
import { LimitExceededError } from "../src/graph/limits.js";
import { runAgent } from "../src/index.js";
import { routeTo, fakeDeps, memoryLedger, recordingRouters, usageRecord } from "./helpers.js";

const tempDir = (): Promise<string> => mkdtemp(join(tmpdir(), "ledger-"));
const at = (iso: string) => () => new Date(iso);

describe("utcDay", () => {
  it("uses the UTC date, not the local one", () => {
    expect(utcDay(new Date("2026-09-24T23:59:59.999Z"))).toBe("2026-09-24");
    expect(utcDay(new Date("2026-09-25T00:00:00.000Z"))).toBe("2026-09-25");
  });
});

describe("file ledger", () => {
  it("starts a bundle's day at zero", async () => {
    expect(await createFileLedger(await tempDir()).spentToday("bundle")).toBe(0);
  });

  it("sums what was recorded today into a per-bundle, per-day JSONL file", async () => {
    const dir = await tempDir();
    const ledger = createFileLedger(dir, at("2026-09-24T10:00:00Z"));

    await ledger.record("bundle", [usageRecord("router:main", 0.01), usageRecord("coder", 0.02)]);
    await ledger.record("bundle", [usageRecord("coder", 0.03)]);

    expect(await ledger.spentToday("bundle")).toBeCloseTo(0.06);
    const file = await readFile(join(dir, "bundle", "2026-09-24.jsonl"), "utf8");
    expect(file.trim().split("\n")).toHaveLength(3);
  });

  it("resets at 00:00 UTC", async () => {
    const dir = await tempDir();
    await createFileLedger(dir, at("2026-09-24T23:59:00Z")).record("bundle", [usageRecord("a", 1)]);

    expect(await createFileLedger(dir, at("2026-09-25T00:00:01Z")).spentToday("bundle")).toBe(0);
  });

  it("keeps bundles apart", async () => {
    const ledger = createFileLedger(await tempDir());
    await ledger.record("one", [usageRecord("a", 1)]);

    expect(await ledger.spentToday("two")).toBe(0);
  });

  it("does not touch the disk for an empty batch", async () => {
    const dir = await tempDir();

    await createFileLedger(dir).record("bundle", []);

    await expect(readFile(join(dir, "bundle", `${utcDay(new Date())}.jsonl`))).rejects.toThrow();
  });

  it("surfaces read errors other than a missing file", async () => {
    const dir = await tempDir();
    const now = at("2026-09-24T10:00:00Z");
    await mkdir(join(dir, "bundle", "2026-09-24.jsonl"), { recursive: true });

    await expect(createFileLedger(dir, now).spentToday("bundle")).rejects.toThrow();
  });
});

describe("daily cap in a run", () => {
  it("refuses to run without a single call when the bundle's day is spent", async () => {
    const { deps, requests } = recordingRouters(fakeDeps({}, memoryLedger(10)));

    const failure = runAgent({ task: "Anything" }, deps);

    await expect(failure).rejects.toBeInstanceOf(LimitExceededError);
    await expect(failure).rejects.toMatchObject({ key: "limits.perDay.cost", limit: 10 });
    expect(requests).toEqual([]);
  });

  it("gives the run the run cap while the day is young", async () => {
    const deps = fakeDeps(
      { "test/router": [routeTo("alpha"), routeTo("replyWith", "done")], "test/alpha": ["42"] },
      memoryLedger(0.5),
    );

    expect((await runAgent({ task: "Anything" }, deps)).budgetUsd).toBe(1);
  });

  it("gives the run what is left of the day and records every call", async () => {
    const ledger = memoryLedger(9.75);
    const deps = fakeDeps(
      { "test/router": [routeTo("alpha"), routeTo("replyWith", "done")], "test/alpha": ["42"] },
      ledger,
    );

    const result = await runAgent({ task: "Anything" }, deps);

    expect(result.budgetUsd).toBeCloseTo(0.25);
    expect(ledger.recorded.map((record) => record.caller)).toEqual([
      "router:main",
      "alpha",
      "router:main",
    ]);
  });
});

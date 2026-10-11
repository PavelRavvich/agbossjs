import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  goldenFile,
  goldenFromRecent,
  GoldenSetError,
  loadGolden,
  saveGolden,
} from "../../src/eval/golden.js";
import { runAgent } from "../../src/index.js";
import { routeTo, fakeDeps } from "../helpers.js";

describe("golden sets", () => {
  it("AC3: saves the last real tasks (distinct, oldest first) and reads them back", async () => {
    const deps = fakeDeps({
      "test/router": Array.from({ length: 3 }, () => [
        routeTo("alpha"),
        routeTo("replyWith"),
      ]).flat(),
      "test/alpha": ["a", "b", "c"],
    });
    for (const task of ["q1", "q1", "q2"]) await runAgent({ task }, deps);
    const file = goldenFile(await mkdtemp(join(tmpdir(), "golden-")), "test-bundle", "core");

    const set = await goldenFromRecent(
      deps.terns,
      "test-bundle",
      "core",
      10,
      () => new Date("2026-09-25T00:00:00Z"),
    );
    await saveGolden(file, set);

    expect(set.tasks).toEqual([{ task: "q1" }, { task: "q2" }]);
    expect(await loadGolden(file)).toEqual(set);
    expect(file).toMatch(/golden\/test-bundle\/core\.yaml$/);
  });

  it("AC3: an invalid golden file and a bundle without tasks are clear errors", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "golden-")), "bad.yaml");
    await writeFile(file, "name: x\nbundle: b\ncreated: now\ntasks: []\n");

    await expect(loadGolden(file)).rejects.toThrow(`${file}: tasks`);
    await expect(goldenFromRecent(fakeDeps({}).terns, "empty", "x", 5)).rejects.toBeInstanceOf(
      GoldenSetError,
    );
  });
});

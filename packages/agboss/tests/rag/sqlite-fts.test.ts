import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chunkMarkdown, ftsQuery, SqliteFtsConnector } from "../../src/rag/sqlite-fts.js";

const signal = new AbortController().signal;

async function docs(): Promise<{ folder: string; connector: SqliteFtsConnector }> {
  const folder = await mkdtemp(join(tmpdir(), "fts-"));
  await writeFile(
    join(folder, "onboarding.md"),
    "# Onboarding\n\nOn-call starts after your third month.\n\n## Day 5\n\nDemo at the Friday show-and-tell.",
  );
  await writeFile(join(folder, "product.md"), "# Nimbus\n\nNimbus predicts frost and heavy rain.");
  await writeFile(join(folder, "notes.bin"), "ignored");
  return {
    folder,
    connector: new SqliteFtsConnector({ folder, dbFile: join(folder, "index", "fts.sqlite") }),
  };
}

describe("SQLite FTS5 connector (reference implementation)", () => {
  it("AC3: indexes Markdown, skips unchanged files, re-indexes a changed one; no cost", async () => {
    const { folder, connector } = await docs();

    const first = await connector.index();
    const second = await connector.index();
    await writeFile(
      join(folder, "product.md"),
      "# Nimbus\n\nNimbus predicts frost, rain and hail.",
    );
    const third = await connector.index();

    expect(first).toEqual({ documents: 2, chunks: 3, skipped: 0, costUsd: 0 });
    expect(second.skipped).toBe(2);
    expect(third).toMatchObject({ documents: 2, skipped: 1 });
  });

  it("AC2: top-k results by BM25 with the file as source; builds the index on first use", async () => {
    const { connector } = await docs();

    const retrieval = await connector.retrieve("When does on-call start?", { topK: 1, signal });

    expect(retrieval.results).toHaveLength(1);
    expect(retrieval.results[0]).toMatchObject({ source: "onboarding.md" });
    expect(retrieval.results[0]?.text).toContain("On-call starts after your third month.");
    expect(retrieval.costUsd).toBe(0);
  });

  it("no terms or no match → no results; k larger than the corpus returns what there is", async () => {
    const { connector } = await docs();

    expect((await connector.retrieve("?!", { topK: 3, signal })).results).toEqual([]);
    expect((await connector.retrieve("kubernetes", { topK: 3, signal })).results).toEqual([]);
    expect(
      (await connector.retrieve("Nimbus frost on-call", { topK: 50, signal })).results.length,
    ).toBeLessThanOrEqual(3);
  });

  it("chunks at headings, merges paragraphs up to the limit; queries are quoted words OR-ed", () => {
    expect(chunkMarkdown("# A\n\none\n\ntwo\n\n# B\n\nthree", 100)).toEqual([
      "# A\n\none\n\ntwo",
      "# B\n\nthree",
    ]);
    expect(chunkMarkdown("x".repeat(25), 10)).toEqual([
      "x".repeat(10),
      "x".repeat(10),
      "x".repeat(5),
    ]);
    expect(ftsQuery("On-call: when? on-call")).toBe('"on" OR "call" OR "when"');
    expect(ftsQuery("?")).toBeUndefined();
  });
});

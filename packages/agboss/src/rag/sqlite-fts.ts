import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { IndexReport, RagConnector, RagRetrieval } from "./types.js";

/** Where the documents are and where the index lives. */
export interface FtsOptions {
  readonly folder: string;
  readonly dbFile: string;
  /** Upper bound of a chunk (default 800 characters). */
  readonly maxChunkChars?: number;
}

const DEFAULT_CHUNK_CHARS = 800;
const DOCUMENT_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const MAX_TERMS = 12;

/** Splits Markdown at headings, then merges paragraphs into chunks of at most `max` characters. */
export function chunkMarkdown(text: string, max: number): string[] {
  const paragraphs = text
    .split(/\n(?=#{1,6} )|\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs.flatMap((p) =>
    p.length <= max ? [p] : (p.match(new RegExp(`[\\s\\S]{1,${String(max)}}`, "g")) ?? []),
  )) {
    const startsSection = /^#{1,6} /.test(paragraph);
    if (current !== "" && (startsSection || current.length + paragraph.length + 2 > max)) {
      chunks.push(current);
      current = "";
    }
    current = current === "" ? paragraph : `${current}\n\n${paragraph}`;
  }
  if (current !== "") chunks.push(current);
  return chunks;
}

/** A user question as an FTS5 query: its distinct words (2+ letters), quoted, OR-ed. */
export function ftsQuery(query: string): string | undefined {
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((term) => term.length >= 2)
    .slice(0, MAX_TERMS);
  return terms.length === 0 ? undefined : terms.map((term) => `"${term}"`).join(" OR ");
}

const Hit = z.object({ source: z.string(), text: z.string(), rank: z.number() });
const Count = z.object({ n: z.number() });
const FileRow = z.object({ source: z.string(), hash: z.string() });

/**
 * Reference knowledge base: SQLite FTS5 full-text search ranked by BM25 over a folder of Markdown —
 * built into Node, no dependencies, no cost. Vector search would be another connector with the
 * same contract (e.g. sqlite-vec + an embeddings model).
 */
export class SqliteFtsConnector implements RagConnector {
  private db: DatabaseSync | undefined;

  constructor(private readonly options: FtsOptions) {}

  async index(): Promise<IndexReport> {
    const db = this.open();
    const known = new Map(
      db
        .prepare("SELECT source, hash FROM files")
        .all()
        .map((row) => {
          const r = FileRow.parse(row);
          return [r.source, r.hash] as const;
        }),
    );
    const files = (await readdir(this.options.folder, { recursive: true }))
      .filter((file) => DOCUMENT_EXTENSIONS.has(extname(file).toLowerCase()))
      .sort();
    let skipped = 0;
    for (const source of files) {
      const text = await readFile(join(this.options.folder, source), "utf8");
      const hash = createHash("sha256").update(text).digest("hex");
      if (known.get(source) === hash) {
        skipped += 1;
        continue;
      }
      this.replace(
        db,
        source,
        hash,
        chunkMarkdown(text, this.options.maxChunkChars ?? DEFAULT_CHUNK_CHARS),
      );
    }
    for (const gone of [...known.keys()].filter((source) => !files.includes(source)))
      this.replace(db, gone, undefined, []);
    const chunks = Count.parse(db.prepare("SELECT COUNT(*) AS n FROM chunks").get()).n;
    return { documents: files.length, chunks, skipped, costUsd: 0 };
  }

  async retrieve(
    query: string,
    options: { readonly topK: number; readonly signal: AbortSignal },
  ): Promise<RagRetrieval> {
    const db = this.open();
    if (Count.parse(db.prepare("SELECT COUNT(*) AS n FROM files").get()).n === 0)
      await this.index();
    const match = ftsQuery(query);
    if (match === undefined) return { results: [], costUsd: 0 };
    const hits = db
      .prepare(
        "SELECT source, text, bm25(chunks) AS rank FROM chunks WHERE chunks MATCH ? ORDER BY rank LIMIT ?",
      )
      .all(match, options.topK)
      .map((row) => Hit.parse(row));
    return {
      results: hits.map((hit) => ({ source: hit.source, text: hit.text, score: -hit.rank })),
      costUsd: 0,
    };
  }

  private replace(
    db: DatabaseSync,
    source: string,
    hash: string | undefined,
    chunks: readonly string[],
  ): void {
    db.prepare("DELETE FROM chunks WHERE source = ?").run(source);
    db.prepare("DELETE FROM files WHERE source = ?").run(source);
    if (hash === undefined) return;
    const insert = db.prepare("INSERT INTO chunks (source, text) VALUES (?, ?)");
    for (const chunk of chunks) insert.run(source, chunk);
    db.prepare("INSERT INTO files VALUES (?, ?)").run(source, hash);
  }

  private open(): DatabaseSync {
    if (this.db !== undefined) return this.db;
    mkdirSync(dirname(this.options.dbFile), { recursive: true });
    const db = new DatabaseSync(this.options.dbFile);
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(source, text);
      CREATE TABLE IF NOT EXISTS files (source TEXT PRIMARY KEY, hash TEXT NOT NULL);`);
    this.db = db;
    return db;
  }
}

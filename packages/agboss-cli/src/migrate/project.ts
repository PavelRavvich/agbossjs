import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ScaffoldUsageError } from "../scaffold/errors.js";
import type { Changes, FileToWrite } from "../scaffold/write.js";
import { frameworkMoves, type ImportMoves } from "./moves.js";
import { migrateImports } from "./rewrite.js";

const SKIPPED = new Set(["node_modules", "dist", "coverage"]);
const SOURCE = /\.(ts|tsx|mts|cts)$/;

/** Every TypeScript file under `path` (a file or a folder): no dependencies, builds or dot folders. */
export function sourcesUnder(path: string): string[] {
  if (!existsSync(path)) throw new ScaffoldUsageError(`Not found: ${path}`);
  if (!statSync(path).isDirectory()) return SOURCE.test(path) ? [path] : [];
  return readdirSync(path)
    .filter((name) => !SKIPPED.has(name) && !name.startsWith("."))
    .sort()
    .flatMap((name) => {
      const child = join(path, name);
      return statSync(child).isDirectory() ? sourcesUnder(child) : SOURCE.test(name) ? [child] : [];
    });
}

/** What `agboss migrate imports` would change: the files, how many it read, what needs a look. */
export interface ImportMigration {
  readonly changes: Changes;
  readonly scanned: number;
  readonly warnings: readonly string[];
}

/**
 * The import migration of the files under `paths` (relative to `root`, default the whole project):
 * old entries → new entries, renamed names under their new name (#195). Nothing is written here.
 */
export function planImportMigration(
  root: string,
  paths: readonly string[] = ["."],
  moves: ImportMoves = frameworkMoves(),
): ImportMigration {
  const files = [...new Set(paths.flatMap((path) => sourcesUnder(resolve(root, path))))];
  const warnings: string[] = [];
  const modify: FileToWrite[] = [];
  for (const file of files) {
    const path = relative(root, file);
    const migrated = migrateImports(readFileSync(file, "utf8"), path, moves);
    warnings.push(...migrated.warnings);
    if (migrated.changed) modify.push({ path, content: migrated.text });
  }
  return { changes: { create: [], modify }, scanned: files.length, warnings };
}

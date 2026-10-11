import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { FileToWrite } from "./write.js";

/** The part of prettier the generator uses. */
interface Prettier {
  readonly format: (text: string, options: Record<string, unknown>) => Promise<string>;
  readonly resolveConfig: (file: string) => Promise<Record<string, unknown> | null>;
  readonly getFileInfo: (file: string) => Promise<{ readonly inferredParser: string | null }>;
}

const isPrettier = (value: unknown): value is Prettier =>
  typeof value === "object" &&
  value !== null &&
  "format" in value &&
  typeof value.format === "function" &&
  "resolveConfig" in value &&
  typeof value.resolveConfig === "function" &&
  "getFileInfo" in value &&
  typeof value.getFileInfo === "function";

/** The project's prettier (or the one next to the framework); undefined when neither is installed. */
async function prettierFor(root: string): Promise<Prettier | undefined> {
  for (const base of [join(root, "package.json"), import.meta.url]) {
    try {
      const loaded: unknown = await import(
        pathToFileURL(createRequire(base).resolve("prettier")).href
      );
      const candidate =
        typeof loaded === "object" && loaded !== null && "default" in loaded
          ? loaded.default
          : loaded;
      if (isPrettier(candidate)) return candidate;
      if (isPrettier(loaded)) return loaded;
    } catch {
      // not installed there
    }
  }
  return undefined;
}

/**
 * Generated and rewired files in the project's prettier style (#197), so they pass `prettier --check`
 * with the project's config; without prettier the files stay as rendered.
 */
export async function formatFiles(
  root: string,
  files: readonly FileToWrite[],
): Promise<FileToWrite[]> {
  const prettier = await prettierFor(root);
  if (prettier === undefined) return [...files];
  return Promise.all(
    files.map(async (file) => {
      const filepath = join(root, file.path);
      const { inferredParser } = await prettier.getFileInfo(filepath);
      if (inferredParser === null) return file;
      const config = (await prettier.resolveConfig(filepath)) ?? {};
      const content = await prettier.format(file.content, { ...config, filepath });
      return { ...file, content };
    }),
  );
}

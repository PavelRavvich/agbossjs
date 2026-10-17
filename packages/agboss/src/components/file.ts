import fs from "node:fs";
import path from "node:path";
import { callerFile } from "./call-site.js";

/** Reads a text file relative to the caller's file (a static prompt, a fixture). */
export function file(filePath: string): string {
  const caller = callerFile();
  if (!caller) {
    throw new Error(`file(): could not determine caller file for ${filePath}`);
  }
  return fs.readFileSync(path.resolve(path.dirname(caller), filePath), "utf-8");
}

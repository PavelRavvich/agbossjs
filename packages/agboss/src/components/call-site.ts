import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

/** The framework's own source (src/ or dist/): frames inside it are skipped. */
const FRAMEWORK = fileURLToPath(new URL("../", import.meta.url));

/**
 * The file that called a decorator factory — the first stack frame outside the framework, read through
 * the V8 CallSite API (structured frames, no parsing of stack text). How `@Agent` finds its prompt file
 * next to it, like Angular's `templateUrl` (Angular's compiler knows the file; a decorator does not).
 */
export function callerFile(): string | undefined {
  // V8's hook is a plain function property meant to be swapped and restored, not a bound method
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const original = Error.prepareStackTrace;
  Error.prepareStackTrace = (_error, frames) => frames;
  try {
    const frames = new Error().stack as unknown as readonly NodeJS.CallSite[];
    for (const frame of frames) {
      const name = frame.getFileName();
      if (name === null) continue;
      const file = name.startsWith("file:") ? fileURLToPath(name) : name;
      if (isAbsolute(file) && !file.startsWith(FRAMEWORK)) return file;
    }
    return undefined;
  } finally {
    Error.prepareStackTrace = original;
  }
}

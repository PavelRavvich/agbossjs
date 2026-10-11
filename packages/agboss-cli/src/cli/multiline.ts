import type { Ask } from "./approve.js";

/**
 * One message, possibly over several lines: a line ending with `\` continues on the next one (like
 * Claude Code). Undefined when input ended before anything was typed.
 */
export async function askMessage(
  ask: Ask,
  prompt: string,
  more = "… ",
): Promise<string | undefined> {
  const lines: string[] = [];
  let line = await ask(prompt);
  while (line?.endsWith("\\") === true) {
    lines.push(line.slice(0, -1));
    line = await ask(more);
  }
  if (line === undefined) return lines.length > 0 ? lines.join("\n") : undefined;
  return [...lines, line].join("\n");
}

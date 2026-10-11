import type { Interface } from "node:readline";
import type { Ask } from "./approve.js";
import { cleanLine } from "./keys.js";

/**
 * Line-queue prompt: lines typed (or piped) while the agent is busy are kept, not lost; resolves
 * undefined once input has ended and every line was consumed.
 */
export function askWith(rl: Interface, write: (text: string) => void): Ask {
  const lines: string[] = [];
  const waiting: ((line: string | undefined) => void)[] = [];
  let ended = false;
  rl.on("line", (raw) => {
    const line = cleanLine(raw);
    const next = waiting.shift();
    if (next === undefined) lines.push(line);
    else next(line);
  });
  rl.once("close", () => {
    ended = true;
    waiting.splice(0).forEach((resolve) => {
      resolve(undefined);
    });
  });
  return (question) => {
    write(question);
    const line = lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (ended) return Promise.resolve(undefined);
    return new Promise((resolve) => waiting.push(resolve));
  };
}

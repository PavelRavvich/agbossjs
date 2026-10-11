import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../../src", import.meta.url));
const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".ts"))
  .map((file) => ({ file, text: readFileSync(join(SRC, file), "utf8") }));

describe("AC9: the loop is the framework's own — no createAgent, no middlewares, no reasoning attempts", () => {
  it("nothing in src imports LangChain's agent package or its middlewares", () => {
    const offenders = sources
      .filter(({ text }) =>
        /from "langchain"|createAgent\(|createMiddleware|Middleware\(/.test(text),
      )
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("the reasoning attempts (#79) are gone: no attempts node, settings, records or quality errors", () => {
    const offenders = sources
      .filter(({ text }) =>
        /AttemptRecord|TernAttempt|ReasoningSettings|QualityNotReached|runAttempts|attemptsLines/.test(
          text,
        ),
      )
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
    expect(existsSync(join(SRC, "graph/middleware.ts"))).toBe(false);
    expect(existsSync(join(SRC, "graph/nodes/attempts.ts"))).toBe(false);
  });
});

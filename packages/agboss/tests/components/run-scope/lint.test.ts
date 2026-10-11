import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const RULE = "agboss/no-run-state-in-singleton";

/** The rule's findings for `code` as a framework source file, linted with the repo's own config. */
async function findings(code: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(code, {
    filePath: `${root}packages/agboss/src/components/run-scope.ts`,
  });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === RULE)
    .map((message) => message.message);
}

const tool = (options: string, body: string): string => `
import { Tool } from "./decorators.js";
class Query {}
@Tool({ name: "jobs", description: "d", input: Query, output: Query${options} })
export class Jobs {
  private seen: string[] = [];
  private calls = 0;
  async run(input: Query): Promise<Query> {
${body}
    return Promise.resolve(input);
  }
}
`;

describe("#184 AC2: per-run state on `this` in an app-scoped component is a lint error", () => {
  it("flags `this.x = …` and `this.x++` in run() of an app-scoped @Tool", async () => {
    const found = await findings(tool("", "    this.seen = [];\n    this.calls++;"));

    expect(found).toHaveLength(2);
    expect(found[0]).toContain("`this.seen = …` in run() of an app-scoped @Tool");
    expect(found[1]).toContain("`this.calls = …`");
  }, 60_000);

  it("allows it in a run-scoped component, in locals and outside run()", async () => {
    const runScoped = await findings(tool(', scope: "run"', "    this.seen = [];"));
    const local = await findings(tool("", "    const seen: string[] = [];\n    seen.push('a');"));
    const nested = await findings(
      tool(
        "",
        "    const reset = function (this: { n: number }) { this.n = 0; };\n    void reset;",
      ),
    );

    expect([runScoped, local, nested]).toEqual([[], [], []]);
  }, 60_000);
});

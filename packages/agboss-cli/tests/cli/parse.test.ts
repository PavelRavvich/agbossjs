import { describe, expect, it } from "vitest";
import { COMMANDS } from "../../src/cli/commands.js";
import type { CliIo, CommandContext } from "../../src/cli/context.js";
import { CliError } from "../../src/cli/errors.js";
import { parseCommand } from "../../src/cli/parse.js";
import { runTargetOf } from "../../src/cli/run-target.js";
import { fixture } from "./agboss.js";

const RUN = COMMANDS.run ?? { summary: "", usage: "", options: [] };
const WORKFLOW = fixture("test-workflow/test.workflow.ts");
const io: CliIo = { stdout: process.stdout, stderr: process.stderr, env: {}, cwd: process.cwd() };

const runContext = (argv: readonly string[]): CommandContext => ({
  command: "run",
  ...parseCommand("run", RUN, argv),
  json: false,
  io,
  say: () => undefined,
  warn: () => undefined,
});

describe('#198: agboss run --workflow <path> "task"', () => {
  it("parses the documented form, --input, and the older positional path", () => {
    expect(runTargetOf(runContext(["--workflow", "src/a.workflow.ts", "find", "jobs"]))).toEqual({
      file: "src/a.workflow.ts",
      task: "find jobs",
    });
    expect(runTargetOf(runContext(["--input", "find jobs"]))).toEqual({
      file: "./src/workflow.ts",
      task: "find jobs",
    });
    expect(runTargetOf(runContext([WORKFLOW, "find", "jobs"]))).toEqual({
      file: WORKFLOW,
      task: "find jobs",
    });
  });

  it("an option missing its value is a usage error naming it", () => {
    expect(() => parseCommand("run", RUN, ["--workflow"])).toThrow(
      new CliError(
        "usage",
        "usage.option-value",
        "option --workflow needs a value — see agboss help run",
      ),
    );
  });
});

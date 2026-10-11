import { describe, expect, it } from "vitest";
import { CHECKS } from "../../src/check.js";
import { envelope, fixture, agboss } from "./agboss.js";

const BROKEN = fixture("cli/broken.workflow.ts");
const BAD_PROMPTS = fixture("cli/bad-prompts.workflow.ts");
const WORKFLOW = fixture("test-workflow/test.workflow.ts");
/** A prompt of the framework's tests, outside this package: reported by its absolute path. */
const TYPO = new URL("../../../agboss/tests/components/prompts/typo.prompt.md", import.meta.url)
  .pathname;

interface CheckResult {
  readonly workflow: string;
  readonly checks: readonly string[];
  readonly problems: readonly { file: string; code: string; message: string }[];
}

describe("#198 AC3: agboss check runs every key-free validation", () => {
  it("a graph rule violation: file code message lines, exit 3, no API key", async () => {
    const call = await agboss(["check", "--workflow", BROKEN]);

    expect(call.code).toBe(3);
    const lines = call.stdout.trimEnd().split("\n");
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\S*broken\.workflow\.ts graph\.dead-end \S/),
        expect.stringMatching(/^\S*broken\.workflow\.ts graph\.unreachable-node \S/),
      ]),
    );
    expect(call.stderr).toMatch(/^agboss check: \d+ problem\(s\) in /);
  });

  it("--json: one envelope with every problem; ok false, exit 3", async () => {
    const call = await agboss(["check", "--workflow", BROKEN, "--json"]);

    expect(call.code).toBe(3);
    const parsed = envelope(call);
    expect(parsed).toMatchObject({
      schema: 1,
      ok: false,
      command: "check",
      error: { code: "check.failed" },
    });
    const result = parsed.result as CheckResult;
    expect(result.checks).toEqual(["assembly", "environment", "prompts"]);
    expect(result.problems.map((p) => p.code)).toEqual(
      expect.arrayContaining(["graph.dead-end", "graph.unreachable-node"]),
    );
    expect(result.problems.every((p) => p.file === BROKEN)).toBe(true);
  });

  it("a sound workflow passes: ok line, exit 0", async () => {
    const call = await agboss(["check", "--workflow", WORKFLOW]);

    expect(call).toMatchObject({ code: 0, stderr: "" });
    expect(call.stdout).toBe(`ok: ${WORKFLOW} — assembly, environment, prompts\n`);
  });

  it("checks needing the network run only with their flag (--models)", () => {
    expect(CHECKS.map((check) => [check.name, check.flag])).toEqual([
      ["environment", undefined],
      ["prompts", undefined],
      ["models", "models"],
    ]);
  });
});

describe("#199 + #198: the prompts check runs on every agboss check", () => {
  it("every prompt problem is one file[:line] code message line, exit 3, no API key", async () => {
    const call = await agboss(["check", "--workflow", BAD_PROMPTS]);

    expect(call.code).toBe(3);
    expect(call.stdout.trimEnd().split("\n")).toEqual([
      `${BAD_PROMPTS} prompt.unknown-variable @Router "main" prompt:2 {{bords}} — known: boards, item`,
      `${TYPO}:4 prompt.unknown-variable {{knownPlace}} — known: boards, boardCount, item`,
    ]);
    expect(call.stderr).toMatch(/^agboss check: 2 problem\(s\) in /);
  });

  it("--prompts is still accepted (prompts are always checked); --json carries the line", async () => {
    const call = await agboss(["check", "--prompts", "--workflow", BAD_PROMPTS, "--json"]);

    expect(call.code).toBe(3);
    const result = envelope(call).result as CheckResult & {
      problems: readonly { line?: number }[];
    };
    expect(result.checks).toEqual(["assembly", "environment", "prompts"]);
    expect(result.problems[1]).toEqual({
      file: TYPO,
      line: 4,
      code: "prompt.unknown-variable",
      message: "{{knownPlace}} — known: boards, boardCount, item",
    });
  });

  it("a workflow whose prompts render passes with --prompts: exit 0", async () => {
    const call = await agboss(["check", "--prompts", "--workflow", WORKFLOW]);

    expect(call).toMatchObject({
      code: 0,
      stdout: `ok: ${WORKFLOW} — assembly, environment, prompts\n`,
    });
  });
});

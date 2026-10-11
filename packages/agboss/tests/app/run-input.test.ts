import { beforeEach, describe, expect, it, vi } from "vitest";
import { workflowOf } from "../../src/components/assemble.js";
import { fillInputFields } from "../../src/components/prompt-input-fields.js";
import { PromptError } from "../../src/components/prompt-problems.js";
import { callTool, replyWith, testWith, type ModelRequest } from "../../src/testing/index.js";
import {
  Apply,
  JobSearch,
  Lookup,
  resetSeen,
  SearchStart,
  Searcher,
  seen,
  TypoSearch,
} from "./fixtures/run-input.workflow.js";

const systemOf = (request: ModelRequest): string => (request.kind === "chat" ? request.system : "");
const approve = { approved: true, by: "dana" };
const test = testWith(JobSearch);

beforeEach(resetSeen);

describe("#236: the whole validated start input stays on the run", () => {
  test("AC1: a start field reaches a tool and an action as ctx.run.input", async ({
    app,
    mockLlm,
  }) => {
    mockLlm(Searcher).thenReturn(callTool(Lookup, { text: "rust" }), replyWith("2 jobs."));

    const done = await app.execute(SearchStart, { text: "rust jobs", limit: 5 });

    expect(done.status).toBe("answered");
    expect(seen.tools.map((run) => run.input)).toEqual([{ text: "rust jobs", limit: 5 }]);
    expect(seen.actions.map((run) => run.input)).toEqual([{ text: "rust jobs", limit: 5 }]);
  });

  test("AC2: {{input.limit}} renders in the agent's prompt", async ({ app, mockLlm }) => {
    mockLlm(Searcher).thenReturn(replyWith("3 jobs."));

    await app.execute(SearchStart, { text: "rust jobs", limit: 3 });

    expect(systemOf(mockLlm(Searcher).onlyRequest)).toContain("Return at most 3 jobs.");
  });

  test("AC3: the input survives a pause and its resume — tools, action and prompt", async ({
    app,
    mockLlm,
  }) => {
    mockLlm(Searcher).thenReturn(callTool(Apply, { text: "job 1" }), replyWith("Applied."));

    const paused = await app.execute(SearchStart, { text: "apply", limit: 7 });
    const done = await app.resume(paused.thread, approve);

    expect(paused.status).toBe("paused");
    expect(done.status).toBe("answered");
    expect(seen.tools.map((run) => run.input)).toEqual([{ text: "apply", limit: 7 }]);
    expect(seen.actions.map((run) => run.input)).toEqual([{ text: "apply", limit: 7 }]);
    expect(mockLlm(Searcher).requests.map(systemOf)).toEqual([
      expect.stringContaining("Return at most 7 jobs.") as string,
      expect.stringContaining("Return at most 7 jobs.") as string,
    ]);
  });

  test("AC3: the input survives a restart of the app while the run waits", async ({
    app,
    recoverApp,
    mockLlm,
  }) => {
    mockLlm(Searcher).thenReturn(callTool(Apply, { text: "job 1" }), replyWith("Applied."));

    const paused = await app.execute(SearchStart, { text: "apply", limit: 2 });
    const restarted = await recoverApp();
    await restarted.resume(paused.thread, approve);

    expect(seen.tools.map((run) => run.input)).toEqual([{ text: "apply", limit: 2 }]);
    expect(seen.actions.map((run) => run.input)).toEqual([{ text: "apply", limit: 2 }]);
  });
});

describe("#236: {{input.<field>}} is checked at assembly where the starts are known", () => {
  it("a field no start of the workflow has fails assembly, naming the field and the prompt", async () => {
    const error = await workflowOf(TypoSearch).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PromptError);
    expect((error as PromptError).problems).toEqual([
      {
        code: "prompt.unknown-variable",
        message: expect.stringMatching(
          /@Agent "typo" prompt:1 \{\{input\.limt\}\} — no workflow start has the input field "limt" \(start input fields: text, author, limit\)/,
        ) as string,
      },
    ]);
  });

  it("a field the starts have assembles", async () => {
    await expect(workflowOf(JobSearch)).resolves.toBeDefined();
  });
});

describe("#236: where the start is not known, a missing field renders empty with a warning", () => {
  it("fills the fields the input has and warns about the one it lacks", () => {
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    try {
      const text = fillInputFields(
        "{{input.text}}: at most {{input.limit}} jobs, tags {{input.tags}}",
        { text: "rust", tags: ["remote"] },
        '@Agent "searcher"',
      );

      expect(text).toBe('rust: at most  jobs, tags [\n  "remote"\n]');
      expect(warn).toHaveBeenCalledWith(
        '@Agent "searcher": {{input.limit}} — the run\'s start input has no field "limit"; rendered empty',
        { code: "prompt.missing-input-field" },
      );
    } finally {
      warn.mockRestore();
    }
  });
});

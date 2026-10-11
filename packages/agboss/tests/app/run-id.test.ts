import { beforeEach, describe, expect, it } from "vitest";
import { runAgent } from "../../src/run/run-agent.js";
import { callTool, replyWith, testWith } from "../../src/testing/index.js";
import { fakeDeps, routeTo } from "../helpers.js";
import {
  Apply,
  JobSearch,
  Lookup,
  resetSeen,
  SearchStart,
  Searcher,
  seen,
} from "./fixtures/run-input.workflow.js";

const approve = { approved: true, by: "dana" };
const test = testWith(JobSearch);

beforeEach(resetSeen);

/** The run ids every observer event, tool and action saw, without duplicates. */
const idsSeen = (): string[] => [
  ...new Set([
    ...seen.events.map((event) => event.slice(event.indexOf(":") + 1)),
    ...seen.tools.map((run) => run.runId),
    ...seen.actions.map((run) => run.runId),
  ]),
];

describe("#238: one run id per run", () => {
  test("AC1: observer events, tool and action ctx.run.runId, the Tern and the result carry the same id", async ({
    app,
    mockLlm,
  }) => {
    mockLlm(Searcher).thenReturn(callTool(Lookup, { text: "rust" }), replyWith("2 jobs."));

    const done = await app.execute(SearchStart, { text: "rust jobs", limit: 5 });

    expect(seen.events.map((event) => event.split(":")[0])).toEqual([
      "workflow-start",
      "model-start",
      "tool-start",
      "model-start",
      "action-start",
      "workflow-end",
    ]);
    expect(seen.tools).toHaveLength(1);
    expect(seen.actions).toHaveLength(1);
    expect(idsSeen()).toEqual([done.runId]);
  });

  test("AC1: across a pause and its resume — the same id before and after", async ({
    app,
    mockLlm,
  }) => {
    mockLlm(Searcher).thenReturn(callTool(Apply, { text: "job 1" }), replyWith("Applied."));

    const paused = await app.execute(SearchStart, { text: "apply", limit: 1 });
    const beforeResume = seen.events.length;
    const done = await app.resume(paused.thread, approve);

    expect(paused.status).toBe("paused");
    expect(done.runId).toBe(paused.runId);
    expect(seen.events.length).toBeGreaterThan(beforeResume);
    expect(seen.tools).toHaveLength(1);
    expect(seen.actions).toHaveLength(1);
    expect(idsSeen()).toEqual([paused.runId]);
  });

  test("two runs get two ids", async ({ app, mockLlm }) => {
    mockLlm(Searcher).thenReturn(replyWith("One."), replyWith("Two."));

    const first = await app.execute(SearchStart, { text: "one", limit: 1 });
    const second = await app.execute(
      SearchStart,
      { text: "two", limit: 1 },
      { thread: first.thread },
    );

    expect(first.runId).not.toBe(second.runId);
  });
});

describe("#238: the Tern names the run that wrote it", () => {
  it("the Tern of a run carries the run's id, the one its result has", async () => {
    const deps = fakeDeps({
      "test/router": [routeTo("alpha"), routeTo("replyWith", "done")],
      "test/alpha": ["42"],
    });

    const result = await runAgent({ task: "Answer" }, deps, { runId: "run-given" });

    expect(result.runId).toBe("run-given");
    const [tern] = await deps.terns.lastTerns(result.threadId, 1);
    expect(tern).toMatchObject({ id: result.ternId, runId: "run-given", status: "answered" });
  });
});

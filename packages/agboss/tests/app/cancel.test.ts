import { beforeEach, describe, expect } from "vitest";
import { WorkflowCancelledError } from "../../src/core/errors.js";
import { NotPausedError } from "../../src/index.js";
import { callTool, replyWith, testWith } from "../../src/testing/index.js";
import {
  blocking,
  Charge,
  Checkout,
  Clerk,
  resetSeen,
  seen,
  Start,
  Wait,
} from "./fixtures/run-context.workflow.js";

const approve = { approved: true, by: "dana" };
const test = testWith(Checkout);

beforeEach(resetSeen);

/** Starts a run whose clerk waits in a long tool call; resolves with its thread once it waits. */
function waitingRun(run: () => Promise<unknown>): {
  done: Promise<unknown>;
  thread: Promise<string>;
} {
  const thread = new Promise<string>((resolve) => {
    blocking.started = resolve;
  });
  return { done: run(), thread };
}

describe("#187 AC1: after cancelling a paused run, approving it does not execute the tool", () => {
  test("cancel drops the pause: resume throws NotPausedError and the tool never runs", async ({
    app,
    mockLlm,
  }) => {
    mockLlm(Clerk).thenReturn(callTool(Charge, { text: "10 USD" }), replyWith("Charged."));
    const paused = await app.execute(Start, { text: "charge" });

    const cancelled = await app.cancel(paused.thread);
    const resumed = app.resume(paused.thread, approve);

    expect(paused.status).toBe("paused");
    expect(cancelled).toEqual({ cancelled: true });
    await expect(resumed).rejects.toBeInstanceOf(NotPausedError);
    expect(seen.charges).toEqual([]);
    expect(seen.payments).toEqual([]);
    expect(await app.cancel(paused.thread)).toEqual({ cancelled: false });
  });

  test("the cancel holds after a restart: the recovered app cannot resume it either", async ({
    app,
    recoverApp,
    mockLlm,
  }) => {
    mockLlm(Clerk).thenReturn(callTool(Charge, { text: "10 USD" }), replyWith("Charged."));
    const paused = await app.execute(Start, { text: "charge" });
    await app.cancel(paused.thread);

    const restarted = await recoverApp();

    await expect(restarted.resume(paused.thread, approve)).rejects.toBeInstanceOf(NotPausedError);
    expect(seen.charges).toEqual([]);
  });

  test("a thread with nothing running or paused is not cancelled", async ({ app }) => {
    expect(await app.cancel("no-such-thread")).toEqual({ cancelled: false });
  });
});

describe("#187 AC2: cancelling a running run stops it before the next model/tool call", () => {
  test("cancel aborts ctx.run.signal of the call in flight and the run rejects as cancelled", async ({
    app,
    mockLlm,
  }) => {
    mockLlm(Clerk).thenReturn(callTool(Wait, { text: "a long job" }), replyWith("never"));
    const run = waitingRun(() => app.execute(Start, { text: "wait" }));
    const thread = await run.thread;

    const cancelled = await app.cancel(thread);

    expect(cancelled).toEqual({ cancelled: true });
    await expect(run.done).rejects.toBeInstanceOf(WorkflowCancelledError);
    expect(seen.blocked).toHaveLength(1);
    expect(seen.blocked[0]?.run.aborted).toBe(true);
    expect(seen.blocked[0]?.signal.aborted).toBe(true);
    expect(mockLlm(Clerk).requests).toHaveLength(1);
    expect(seen.payments).toEqual([]);
    await expect(app.resume(thread, approve)).rejects.toBeInstanceOf(NotPausedError);
  });

  test("a resumed run in flight is cancelled the same way", async ({ app, mockLlm }) => {
    mockLlm(Clerk).thenReturn(
      callTool(Charge, { text: "10 USD" }),
      callTool(Wait, { text: "a receipt" }),
      replyWith("never"),
    );
    const paused = await app.execute(Start, { text: "charge, then wait" });
    const run = waitingRun(() => app.resume(paused.thread, approve));
    await run.thread;

    expect(await app.cancel(paused.thread)).toEqual({ cancelled: true });
    await expect(run.done).rejects.toBeInstanceOf(WorkflowCancelledError);
    expect(seen.charges).toHaveLength(1);
    expect(mockLlm(Clerk).requests).toHaveLength(2);
    await expect(app.resume(paused.thread, approve)).rejects.toBeInstanceOf(NotPausedError);
  });
});

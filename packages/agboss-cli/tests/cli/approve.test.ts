/**
 * The terminal's approval loop of `agboss run` / `agboss chat`: a paused run asks in the terminal and
 * continues in the same process — on a real app (`testWith`), its models scripted.
 */
import { userInfo } from "node:os";
import { callTool, replyWith, routeTo, testWith } from "agboss/testing";
import { describe, expect, vi } from "vitest";
import {
  ChatStart,
  Desk,
  MainRouter,
  NotesServer,
  Reply,
  SaveNote,
  Support,
} from "../../../agboss/tests/testing/fixtures/desk.workflow.js";
import {
  memoryLine,
  summaryLine,
  terminalDecision,
  threadLine,
  untilDone,
} from "../../src/cli/approve.js";

const test = testWith(Desk);

describe("terminal approval (agboss run and agboss chat)", () => {
  test("asks about the pending call; yes runs the tool and the run finishes", async ({
    app,
    mockLlm,
    mcpOf,
  }) => {
    mockLlm(MainRouter).thenReturn(routeTo(Support), routeTo(Reply));
    mockLlm(Support).thenReturn(
      callTool(SaveNote, { title: "n1", text: "call back" }),
      replyWith("Saved."),
    );
    const notes = mcpOf(NotesServer).thenReturn({
      write_file: () => Promise.resolve({ content: "ok" }),
    });
    const ask = vi.fn(() => Promise.resolve("y"));

    const paused = await app.execute(ChatStart, { text: "note: call back" });
    const done = await untilDone(paused, app, ask);

    expect(ask).toHaveBeenCalledWith(
      'support wants to call save_note {"title":"n1","text":"call back"} — approve? [y/N] ',
    );
    expect(done).toFinishWith(Reply, { text: "Saved." });
    expect(notes.calls.map((call) => call.tool)).toEqual(["write_file"]);
    expect(summaryLine(done)).toBe(`${done.route.join(" → ")} · stop: ${done.stopReason}`);
  });

  test.for(["n", undefined])(
    "anything but yes — here %s — declines: the tool never runs",
    async (reply, { app, mockLlm, mcpOf }) => {
      mockLlm(MainRouter).thenReturn(routeTo(Support), routeTo(Reply));
      mockLlm(Support).thenReturn(
        callTool(SaveNote, { title: "n1", text: "x" }),
        replyWith("Not saved."),
      );
      const notes = mcpOf(NotesServer).thenReturn({
        write_file: () => Promise.resolve({ content: "ok" }),
      });

      const paused = await app.execute(ChatStart, { text: "note: x" });
      const done = await untilDone(paused, app, () => Promise.resolve(reply));

      expect(done).toFinishWith(Reply, { text: "Not saved." });
      expect(notes.calls).toEqual([]);
    },
  );
});

describe("terminal lines", () => {
  test("#141 AC5: the terminal fills `by` with the OS user and gives a reason when declined", () => {
    const by = userInfo().username;

    expect(terminalDecision(true)).toEqual({ approved: true, by });
    expect(terminalDecision(false)).toEqual({
      approved: false,
      by,
      feedback: "declined in the terminal",
    });
  });

  test("the thread line links the trace when tracing is on", () => {
    expect(threadLine({ thread: "t1", traceUrl: "http://traces/sessions/t1" })).toBe(
      "thread t1 · http://traces/sessions/t1",
    );
    expect(threadLine({ thread: "t1" })).toBe("thread t1");
  });

  test("a run without a route says so", () => {
    expect(summaryLine({ route: [], stopReason: "x" })).toBe("(none) · stop: x");
    expect(memoryLine({})).toBeUndefined();
  });
});

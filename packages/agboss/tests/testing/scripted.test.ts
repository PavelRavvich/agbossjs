import { describe, expect } from "vitest";
import {
  replyWith,
  callTool,
  routeTo,
  failWith,
  ModelFailure,
  testWith,
} from "../../src/testing/index.js";
import { usd } from "../../src/units/index.js";
import {
  ChatStart,
  Desk,
  lifecycle,
  MainRouter,
  NotesServer,
  OrderStatus,
  Reply,
  SaveNote,
  Support,
  Writer,
} from "./fixtures/desk.workflow.js";
import {
  CodeReview,
  Coder,
  PullRequest,
  Reviewer,
  ReviewGate,
  TaskStart,
} from "./fixtures/code-review.workflow.js";
import { toolResultsOf } from "./fixtures/requests.js";

const test = testWith(Desk);
const review = testWith(CodeReview);
const approve = { approved: true, by: "dana" };

describe("AC12: scripted models — answers, tool calls, decisions by script", () => {
  test("an agent answers and calls a tool by script; the router decides by script", async ({
    app,
    mockLlm,
  }) => {
    mockLlm(MainRouter).thenReturn(routeTo(Support), routeTo(Reply));
    mockLlm(Support).thenReturn(callTool(OrderStatus, { orderId: "42" }), replyWith("Shipped."));

    const result = await app.execute(ChatStart, { text: "Where is order 42?" });

    expect(result).toFollowPath([ChatStart, MainRouter, Support, MainRouter, Reply]);
    expect(result).toFinishWith(Reply, { text: "Shipped." });
    expect(mockLlm(Support)).toHaveCalledTools([OrderStatus]);
    expect(toolResultsOf(mockLlm(Support).lastRequest)).toEqual(['{"status":"order 42 shipped"}']);
  });

  review(
    "the code-review cycle: the gate sends the code back to the coder twice",
    async ({ app, mockLlm }) => {
      mockLlm(Coder).thenReturn(replyWith("v1"), replyWith("v2"), replyWith("v3"));
      mockLlm(Reviewer).thenReturn(replyWith("fix A"), replyWith("fix B"), replyWith("clean"));
      mockLlm(ReviewGate).thenReturn(routeTo(Coder), routeTo(Coder), routeTo(PullRequest));

      const result = await app.execute(TaskStart, { text: "Add a flag" });
      // eslint-disable-next-line no-console
      console.log(
        "PATH:",
        result.path.map((n) => n.name),
      );

      const lap = [Coder, Reviewer, ReviewGate];
      expect(result).toFollowPath([TaskStart, ...lap, ...lap, ...lap, PullRequest]);
      expect(result).toFinishWith(PullRequest, { text: "clean" });
    },
  );

  test("thenReturnAlways answers every call after the scripted turns", async ({ app, mockLlm }) => {
    mockLlm(MainRouter).thenReturnAlways(routeTo(Writer));
    mockLlm(MainRouter).thenReturn(
      routeTo(Writer),
      routeTo(Reply),
      routeTo(Writer),
      routeTo(Reply),
    );
    mockLlm(Writer).thenReturn(replyWith("first")).thenReturnAlways(replyWith("again"));

    const first = await app.execute(ChatStart, { text: "hi" });
    const second = await app.execute(ChatStart, { text: "hi again" }, { thread: first.thread });

    expect(first.output).toEqual({ text: "first" });
    expect(second.output).toEqual({ text: "again" });
  });

  test("failWith: a router's failed call fails the run at the router", async ({ app, mockLlm }) => {
    mockLlm(MainRouter).thenReturn(failWith(ModelFailure.Timeout));

    await expect(app.execute(ChatStart, { text: "hi" })).rejects.toFailWith({
      code: "router.failed",
      node: MainRouter,
    });
  });

  test("failWith: an agent's failed call fails the run at the agent", async ({ app, mockLlm }) => {
    mockLlm(MainRouter).thenReturn(routeTo(Writer));
    mockLlm(Writer).thenReturn(failWith(ModelFailure.RateLimited));

    await expect(app.execute(ChatStart, { text: "hi" })).rejects.toFailWith({ node: Writer });
  });

  test("a script shorter than the run fails clearly, naming the class", async ({
    app,
    mockLlm,
  }) => {
    mockLlm(MainRouter).thenReturn(routeTo(Writer), routeTo(Writer));
    mockLlm(Writer).thenReturn(replyWith("only one"));

    const run = app.execute(ChatStart, { text: "hi" });

    await expect(run).rejects.toFailWith({ code: "test.script-exhausted" });
    await expect(run).rejects.toThrow(/script exhausted for Writer: 1 turn scripted, asked for #2/);
  });

  test("routeTo(X) for a node that is not among the router's routes fails the test", async ({
    app,
    mockLlm,
  }) => {
    mockLlm(MainRouter).thenReturn(routeTo(ChatStart));

    await expect(app.execute(ChatStart, { text: "hi" })).rejects.toThrow(
      /test.not-a-route: routeTo\(chat\) for MainRouter: not one of its routes \(reply, support, writer\)/,
    );
  });

  test("a scripted cost is the run's spend", async ({ app, mockLlm }) => {
    mockLlm(MainRouter).thenReturn(routeTo(Writer, { cost: usd(0.001) }), routeTo(Reply));
    mockLlm(Writer).thenReturn(replyWith("hi", { cost: usd(0.002), truncated: true }));

    const result = await app.execute(ChatStart, { text: "hi" });

    expect(result.spend.totalUsd).toBeCloseTo(0.003, 9);
    expect(result.spend.byCaller).toMatchObject({ "router:main": 0.001 });
  });
});

describe("AC12: scripts are picked by position, so a resumed run continues the script", () => {
  test("a run paused in one app and resumed after recoverApp() continues the same script", async ({
    app,
    recoverApp,
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

    const paused = await app.execute(ChatStart, { text: "note: call back" });
    const restarted = await recoverApp();
    const done = await restarted.resume(paused.thread, approve);

    expect(paused).toHavePausedAt(Support);
    expect(done).toFinishWith(Reply, { text: "Saved." });
    expect(done).toFollowPath([ChatStart, MainRouter, Support, MainRouter, Reply]);
    expect(notes.calls.map((call) => call.tool)).toEqual(["write_file"]);
    expect(mockLlm(MainRouter).requests).toHaveLength(1);
  });
});

describe("#148 AC4: recoverApp() closes the current app and returns a new one over the same state", () => {
  test("onStop runs on restart; the new app keeps the ids and the ledger going", async ({
    app,
    recoverApp,
    mockLlm,
  }) => {
    mockLlm(MainRouter).thenReturn(routeTo(Writer, { cost: usd(0.001) }), routeTo(Reply));
    mockLlm(MainRouter).thenReturn(routeTo(Writer), routeTo(Reply));
    mockLlm(Writer).thenReturn(replyWith("one"), replyWith("two"));
    await app.tool(OrderStatus).invoke({ orderId: "1" });
    const first = await app.execute(ChatStart, { text: "1" });
    lifecycle.length = 0;

    const restarted = await recoverApp();
    const second = await restarted.execute(ChatStart, { text: "2" });

    expect(lifecycle).toEqual(["OrderBook.onStop", "OrderBook.onStart"]);
    expect([first.thread, second.thread]).toEqual(["thread-1", "thread-2"]);
    expect(second.output).toEqual({ text: "two" });
  });

  test("the old app fails with test.app-closed after a restart", async ({ app, recoverApp }) => {
    await recoverApp();

    await expect(app.execute(ChatStart, { text: "hi" })).rejects.toFailWith({
      code: "test.app-closed",
    });
    await expect(app.tool(OrderStatus).invoke({ orderId: "1" })).rejects.toThrow(
      /test.app-closed: this app is closed/,
    );
  });

  test("recoverApp() twice: each restart closes the app returned before", async ({
    recoverApp,
    mockLlm,
  }) => {
    mockLlm(MainRouter).thenReturn(routeTo(Writer), routeTo(Reply));
    mockLlm(Writer).thenReturn(replyWith("third"));

    const second = await recoverApp();
    const third = await recoverApp();

    await expect(second.execute(ChatStart, { text: "hi" })).rejects.toFailWith({
      code: "test.app-closed",
    });
    expect((await third.execute(ChatStart, { text: "hi" })).output).toEqual({ text: "third" });
  });
});

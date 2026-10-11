import { describe, expect } from "vitest";
import { replyWith, routeTo, testWith, type ModelScript } from "../../src/testing/index.js";
import { usd } from "../../src/units/index.js";
import {
  ChatStart,
  Desk,
  lifecycle,
  MainRouter,
  OrderBook,
  OrderStatus,
  Reply,
  Writer,
} from "./fixtures/desk.workflow.js";

const test = testWith(Desk);

/** One turn: the router sends the message to the writer, the writer answers, the reply is sent. */
const scriptTurn = (mockLlm: (node: typeof MainRouter) => ModelScript, text: string): void => {
  mockLlm(MainRouter).thenReturn(routeTo(Writer), routeTo(Reply));
  mockLlm(Writer).thenReturn(replyWith(text));
};

describe("AC12: lifecycle is the test context's job", () => {
  test.fails("a test that fails after the app started (its onStop still runs)", async ({ app }) => {
    lifecycle.length = 0;
    await app.tool(OrderStatus).invoke({ orderId: "1" });

    throw new Error("the test fails here");
  });

  test("real components got onStart when the app was built and onStop after the failed test", () => {
    expect(lifecycle).toEqual(["OrderBook.onStart", "OrderBook.onStop"]);
  });

  test("a mocked component has no hooks", async ({ app, mockOf }) => {
    lifecycle.length = 0;
    mockOf(OrderBook).statusOf.mockResolvedValue("mocked");

    await app.tool(OrderStatus).invoke({ orderId: "1" });
    await app.close();

    expect(lifecycle).toEqual([]);
  });
});

describe("AC12: isolation per test", () => {
  test.concurrent(
    "two tests with the same thread id do not see each other (a)",
    async ({ app, mockLlm }) => {
      scriptTurn(mockLlm, "A1");
      scriptTurn(mockLlm, "A2");

      const first = await app.execute(ChatStart, { text: "I am A" });
      await app.execute(ChatStart, { text: "and again" }, { thread: first.thread });

      expect(first.thread).toBe("thread-1");
      expect(mockLlm(MainRouter).lastRequest.input).toContain("I am A");
      expect(mockLlm(MainRouter).lastRequest.input).not.toContain("I am B");
    },
  );

  test.concurrent(
    "two tests with the same thread id do not see each other (b)",
    async ({ app, mockLlm }) => {
      scriptTurn(mockLlm, "B1");
      scriptTurn(mockLlm, "B2");

      const first = await app.execute(ChatStart, { text: "I am B" });
      await app.execute(ChatStart, { text: "and again" }, { thread: first.thread });

      expect(first.thread).toBe("thread-1");
      expect(mockLlm(MainRouter).lastRequest.input).toContain("I am B");
      expect(mockLlm(MainRouter).lastRequest.input).not.toContain("I am A");
    },
  );
});

describe("AC12: a controllable clock — the per-day limit resets after midnight UTC", () => {
  test('app.clock.advance("25h") starts a new day for limits.perDay.cost', async ({
    app,
    mockLlm,
  }) => {
    // the second run stops before the router's second visit: 0.03 + 0.03 ≥ the day's 0.05
    mockLlm(MainRouter).thenReturn(
      routeTo(Writer),
      routeTo(Reply),
      routeTo(Writer),
      routeTo(Writer),
    );
    mockLlm(MainRouter).thenReturn(routeTo(Reply));
    const cost = { cost: usd(0.03) };
    mockLlm(Writer).thenReturn(
      replyWith("one", cost),
      replyWith("two", cost),
      replyWith("three", cost),
    );

    await app.execute(ChatStart, { text: "1" });
    const overDay = app.execute(ChatStart, { text: "2" });
    await expect(overDay).rejects.toFailWith({ code: "limits.perDay.cost" });
    app.clock.advance("25h");
    const nextDay = await app.execute(ChatStart, { text: "3" });

    expect(nextDay.output).toEqual({ text: "three" });
  });
});

import { describe, expect } from "vitest";
import { replyWith, routeTo, testWith } from "../../src/testing/index.js";
import {
  ChatStart,
  Desk,
  MainRouter,
  Reply,
  Support,
  Writer,
} from "../testing/fixtures/desk.workflow.js";

const test = testWith(Desk);

/** The desk's flow says only `from(MainRouter).routes()`; its targets are the router's `routes`. */
describe("#200 D5-A: from(Router).routes() takes its targets from @Router({ routes })", () => {
  test("one run reaches every route target of the router, in the order it picks them", async ({
    app,
    mockLlm,
  }) => {
    mockLlm(MainRouter).thenReturn(routeTo(Support), routeTo(Writer), routeTo(Reply));
    mockLlm(Support).thenReturn(replyWith("Order 7 shipped."));
    mockLlm(Writer).thenReturn(replyWith("Your order 7 has shipped."));

    const result = await app.execute(ChatStart, { text: "where is order 7?" });

    expect(result).toFollowPath([
      ChatStart,
      MainRouter,
      Support,
      MainRouter,
      Writer,
      MainRouter,
      Reply,
    ]);
    expect(result.output).toEqual({ text: "Your order 7 has shipped." });
  });

  test("the router's model is offered exactly the @Router routes, with their texts", async ({
    app,
    mockLlm,
  }) => {
    mockLlm(MainRouter).thenReturn(routeTo(Reply));

    await app.execute(ChatStart, { text: "hi" });

    const request = mockLlm(MainRouter).onlyRequest;
    expect(request.kind === "decision" ? [...request.options].sort() : []).toEqual([
      "reply",
      "support",
      "writer",
    ]);
    expect(request).toMatchObject({
      kind: "decision",
      routes: {
        support: "Orders and notes",
        writer: "Writing replies",
        reply: "Stop and send the replyWith: the contributions replyWith the message",
      },
    });
  });
});

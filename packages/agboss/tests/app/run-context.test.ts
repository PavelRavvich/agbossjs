import { beforeEach, describe, expect } from "vitest";
import type { RunStreamEvent } from "../../src/run/types.js";
import { callTool, replyWith, testWith } from "../../src/testing/index.js";
import { Editor, ItemsStart, tallyKeys, TallyWords } from "../routing/fixtures/batch.workflow.js";
import {
  Charge,
  Checkout,
  Clerk,
  Probe,
  resetSeen,
  Scout,
  seen,
  Start,
  FirstAnswer,
  Slow,
} from "./fixtures/run-context.workflow.js";

const approve = { approved: true, by: "dana" };
const checkout = testWith(Checkout);
const quorum = testWith(FirstAnswer);
const tally = testWith(TallyWords);

beforeEach(resetSeen);

describe("#181: one typed RunContext as ctx.run in tools and actions", () => {
  checkout(
    "a tool and an action see the run's id, thread and the metadata given to execute",
    async ({ app, mockLlm }) => {
      mockLlm(Clerk).thenReturn(callTool(Probe, { text: "order 7" }), replyWith("Found."));

      const done = await app.execute(
        Start,
        { text: "look up order 7" },
        { metadata: { tenant: "acme" } },
      );

      expect(done.status).toBe("answered");
      const [probe] = seen.probes;
      const [payment] = seen.payments;
      expect(probe).toMatchObject({ threadId: done.thread, metadata: { tenant: "acme" } });
      expect(payment?.run).toMatchObject({ threadId: done.thread, metadata: { tenant: "acme" } });
      expect(payment?.run.runId).toBe(probe?.runId);
      expect(probe?.signal.aborted).toBe(false);
    },
  );

  checkout(
    "AC1: two runs of the same workflow give the action two different idempotency keys",
    async ({ app, mockLlm }) => {
      mockLlm(Clerk).thenReturn(replyWith("One."), replyWith("Two."));

      const first = await app.execute(Start, { text: "pay" });
      await app.execute(Start, { text: "pay again" }, { thread: first.thread });

      const [one, two] = seen.payments;
      expect(one?.key).toBe(`${one?.run.runId ?? ""}:pay`);
      expect(two?.key).toBe(`${two?.run.runId ?? ""}:pay`);
      expect(one?.key).not.toBe(two?.key);
    },
  );

  checkout(
    "the idempotency key and the metadata stay the same across a pause and its resume",
    async ({ app, mockLlm }) => {
      mockLlm(Clerk).thenReturn(
        callTool(Probe, { text: "card" }),
        callTool(Charge, { text: "10 USD" }),
        replyWith("Charged."),
      );

      const paused = await app.execute(Start, { text: "charge" }, { metadata: { tenant: "acme" } });
      const done = await app.resume(paused.thread, approve);

      expect(paused.status).toBe("paused");
      expect(done.status).toBe("answered");
      const [probe] = seen.probes;
      const [charge] = seen.charges;
      expect(charge?.runId).toBe(probe?.runId);
      expect(charge?.metadata).toEqual({ tenant: "acme" });
      expect(seen.payments.map((payment) => payment.key)).toEqual([`${probe?.runId ?? ""}:pay`]);
    },
  );

  tally("inside batchParallel the key carries the item's index", async ({ app, mockLlm }) => {
    tallyKeys.length = 0;
    mockLlm(Editor).thenReturn(replyWith("3 words"));

    await app.execute(ItemsStart, { text: "red, green, blue" });

    const runId = tallyKeys[0]?.split(":")[0] ?? "";
    expect([...tallyKeys].sort()).toEqual([
      `${runId}:tally:0`,
      `${runId}:tally:1`,
      `${runId}:tally:2`,
    ]);
  });
});

describe("#181: execute and resume forward onStream", () => {
  checkout(
    "AC2: a caller passing onStream to app.execute receives stream events",
    async ({ app, mockLlm }) => {
      mockLlm(Clerk).thenReturn(replyWith("Hello there."));
      const events: RunStreamEvent[] = [];

      await app.execute(Start, { text: "hi" }, { onStream: (event) => events.push(event) });

      expect(events).toContainEqual({ kind: "textDelta", delta: "Hello there." });
    },
  );

  checkout("resume forwards onStream too", async ({ app, mockLlm }) => {
    mockLlm(Clerk).thenReturn(callTool(Charge, { text: "10 USD" }), replyWith("Charged."));
    const events: RunStreamEvent[] = [];

    const paused = await app.execute(Start, { text: "charge" }, { configurable: { region: "eu" } });
    await app.resume(paused.thread, approve, { onStream: (event) => events.push(event) });

    expect(events).toContainEqual({ kind: "textDelta", delta: "Charged." });
  });
});

describe("#181 AC3: a quorum join behaves the same after pause/resume as without a pause", () => {
  quorum(
    "without a pause the slower branch is cut off once the first one answered",
    async ({ app, mockLlm }) => {
      mockLlm(Scout).thenReturn(replyWith("Scouted."));
      mockLlm(Clerk).thenReturn(callTool(Slow, { text: "order 7" }), replyWith("Too late."));

      await app.execute(Start, { text: "go" });

      expect(mockLlm(Scout).requests).toHaveLength(1);
      expect(mockLlm(Clerk).requests).toHaveLength(1);
    },
  );

  quorum(
    "a branch paused for an approval is cut off on resume too: the other one answered",
    async ({ app, mockLlm }) => {
      mockLlm(Scout).thenReturn(replyWith("Scouted."));
      mockLlm(Clerk).thenReturn(callTool(Charge, { text: "10 USD" }), replyWith("Too late."));

      const paused = await app.execute(Start, { text: "go" });
      await app.resume(paused.thread, approve);

      expect(paused.status).toBe("paused");
      expect(seen.charges).toEqual([]);
      expect(mockLlm(Clerk).requests).toHaveLength(1);
    },
  );
});

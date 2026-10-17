import { beforeEach, describe, expect } from "vitest";
import type { RunStreamEvent } from "../../src/run/types.js";
import { callTool, replyWith, testWith } from "../../src/testing/index.js";
import {
  Charge,
  Checkout,
  Clerk,
  Probe,
  ReceiptDto,
  resetSeen,
  seen,
  Start,
} from "./fixtures/run-context.workflow.js";
import { execute } from "../helpers/flow.js";
import { Mailer, MailV1, SendEmail, sent, Start as MailStart } from "./fixtures/mail.workflow.js";
import { ExecutionStatus } from "../../src/app/types.js";

const approve = { approved: true, by: "dana" };
const checkout = testWith(Checkout);

beforeEach(resetSeen);

describe("#181: one typed RunContext as ctx.run in tools", () => {
  checkout(
    "a tool sees the run's id, thread and the metadata given to execute",
    async ({ app, mockLlm }) => {
      mockLlm(Clerk).thenReturn(
        callTool(Probe, { text: "order 7" }),
        replyWith(ReceiptDto, { text: "Found." }),
      );

      const done = await execute(
        app,
        Start,
        { text: "look up order 7" },
        { metadata: { tenant: "acme" } },
      );

      expect(done.status).toBe(ExecutionStatus.Finished);
      const [probe] = seen.probes;
      expect(probe).toMatchObject({ threadId: done.thread, metadata: { tenant: "acme" } });
      expect(seen.payments).toEqual(["paid"]);
      expect(probe?.signal.aborted).toBe(false);
    },
  );

  checkout(
    "the idempotency key and the metadata stay the same across a pause and its resume",
    async ({ app, mockLlm }) => {
      mockLlm(Clerk).thenReturn(
        callTool(Probe, { text: "card" }),
        callTool(Charge, { text: "10 USD" }),
        replyWith(ReceiptDto, { text: "Charged." }),
      );

      const paused = await execute(
        app,
        Start,
        { text: "charge" },
        { metadata: { tenant: "acme" } },
      );
      const done = await app.resume(paused.thread, approve);

      expect(paused.status).toBe(ExecutionStatus.Paused);
      expect(done.status).toBe(ExecutionStatus.Finished);
      const [probe] = seen.probes;
      const [charge] = seen.charges;
      expect(charge?.runId).toBe(probe?.runId);
      expect(charge?.metadata).toEqual({ tenant: "acme" });
      // the action after the pause runs once
      expect(seen.payments).toEqual(["paid"]);
    },
  );
});

const mail = testWith(MailV1);

describe("#181: execute and resume forward onStream", () => {
  mail(
    "AC2: a caller passing onStream to app.execute receives stream events",
    async ({ app, mockLlm }) => {
      mockLlm(Mailer).thenReturn(replyWith("Hello there."));
      const events: RunStreamEvent[] = [];

      await execute(app, MailStart, { text: "hi" }, { onStream: (event) => events.push(event) });

      expect(events).toContainEqual({ kind: "textDelta", delta: "Hello there." });
    },
  );

  mail("resume forwards onStream too", async ({ app, mockLlm }) => {
    sent.length = 0;
    mockLlm(Mailer).thenReturn(callTool(SendEmail, { to: "dana" }), replyWith("Sent."));
    const events: RunStreamEvent[] = [];

    const paused = await execute(
      app,
      MailStart,
      { text: "mail" },
      { configurable: { region: "eu" } },
    );
    await app.resume(paused.thread, approve, { onStream: (event) => events.push(event) });

    expect(events).toContainEqual({ kind: "textDelta", delta: "Sent." });
  });
});

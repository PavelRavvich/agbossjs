/** #202 AC1: a thread belongs to its owner — another owner cannot continue, resume or cancel it. */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp, type AppOptions } from "../../src/app/create-app.js";
import { ThreadOwnerError } from "../../src/index.js";
import { createMemoryLedger } from "../../src/finops/ledger.js";
import { createSqliteTernStore } from "../../src/terns/index.js";
import { callTool, replyWith } from "../../src/testing/index.js";
import { ScriptBook } from "../../src/testing/script-book.js";
import { createScriptedGateway } from "../../src/testing/scripted-gateway.js";
import { ApprovalDesk, ChatStart, type ButtonClick } from "../channels/approval.workflow.js";
import { Pay, PaymentLog, Payments } from "./isolation.workflow.js";

const offline = (book: ScriptBook): AppOptions => ({
  processEnv: {},
  gateway: createScriptedGateway(book),
  stores: { terns: createSqliteTernStore(":memory:"), ledger: createMemoryLedger() },
});

const approve: ButtonClick = { action: "approve", user: "dana" };
const card = { orderId: "A-1", cardNumber: "4111 1111 1111 1111" };

describe("#202 AC1: threads are bound to their owner", () => {
  it("AC1: another owner cannot continue a thread — nothing runs, its history is never read", async () => {
    const book = new ScriptBook();
    const cashier = book.scriptOf("agent:cashier").thenReturnAlways(replyWith("Hello."));
    const app = await createApp(Payments, offline(book));
    const first = await app.execute(ChatStart, { text: "my card is 4111" }, { owner: "alice" });

    const intruder = app.execute(
      ChatStart,
      { text: "what was my card?" },
      {
        thread: first.thread,
        owner: "bob",
      },
    );
    await expect(intruder).rejects.toBeInstanceOf(ThreadOwnerError);
    await expect(intruder).rejects.toMatchObject({ code: "run.thread-owner" });
    await expect(intruder).rejects.not.toThrow(/alice/);
    const anonymous = app.execute(ChatStart, { text: "hi" }, { thread: first.thread });
    await expect(anonymous).rejects.toMatchObject({ code: "run.thread-owner" });
    expect(cashier.requests).toHaveLength(1);

    const again = await app.execute(
      ChatStart,
      { text: "thanks" },
      {
        thread: first.thread,
        owner: "alice",
      },
    );
    expect(again).toMatchObject({ status: "answered", thread: first.thread });
    expect(cashier.requests).toHaveLength(2);
    await app.close();
  });

  it("AC1: another owner cannot resume or cancel a paused run; its owner resumes it", async () => {
    const book = new ScriptBook();
    book.scriptOf("agent:cashier").thenReturn(callTool(Pay, card), replyWith("Paid."));
    const app = await createApp(Payments, offline(book));
    const log = app.resolve(PaymentLog);
    const paused = await app.execute(ChatStart, { text: "pay A-1" }, { owner: "alice" });
    expect(paused).toMatchObject({ status: "paused", pause: { tool: "pay" } });

    await expect(app.resume(paused.thread, approve, { owner: "bob" })).rejects.toBeInstanceOf(
      ThreadOwnerError,
    );
    await expect(app.cancel(paused.thread, { owner: "bob" })).rejects.toBeInstanceOf(
      ThreadOwnerError,
    );
    await expect(app.resume(paused.thread, approve)).rejects.toBeInstanceOf(ThreadOwnerError);
    expect(log.owners).toEqual([]);

    const done = await app.resume(paused.thread, approve, { owner: "alice" });
    expect(done).toMatchObject({ status: "answered", output: { text: "Paid." } });
    expect(log.owners).toEqual(["alice"]);
    await app.close();
  });

  it("AC1: the owner cancels its own paused run; threads without an owner work as before", async () => {
    const book = new ScriptBook();
    book.scriptOf("agent:cashier").thenReturn(callTool(Pay, card), replyWith("Hi."));
    const app = await createApp(Payments, offline(book));
    const paused = await app.execute(ChatStart, { text: "pay A-1" }, { owner: "alice" });

    expect(await app.cancel(paused.thread, { owner: "alice" })).toEqual({ cancelled: true });
    const open = await app.execute(ChatStart, { text: "hi" });
    expect(open.status).toBe("answered");
    await expect(app.cancel(open.thread, { owner: "bob" })).rejects.toBeInstanceOf(
      ThreadOwnerError,
    );
    expect(await app.cancel(open.thread)).toEqual({ cancelled: false });
    expect(app.resolve(ApprovalDesk).posted).toHaveLength(1);
    await app.close();
  });

  it("AC1: the binding is stored with the thread — an app over the same database keeps it", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "owners-")), "terns.sqlite");
    const book = new ScriptBook();
    book.scriptOf("agent:cashier").thenReturnAlways(replyWith("Hello."));
    const appOn = (terns: ReturnType<typeof createSqliteTernStore>) =>
      createApp(Payments, { ...offline(book), stores: { terns, ledger: createMemoryLedger() } });
    const firstStore = createSqliteTernStore(path);
    const first = await appOn(firstStore);
    const { thread } = await first.execute(ChatStart, { text: "hi" }, { owner: "alice" });
    await first.close();
    firstStore.close();

    const secondStore = createSqliteTernStore(path);
    const second = await appOn(secondStore);
    const intruder = second.execute(ChatStart, { text: "hi" }, { thread, owner: "bob" });
    await expect(intruder).rejects.toBeInstanceOf(ThreadOwnerError);
    const own = await second.execute(ChatStart, { text: "hi" }, { thread, owner: "alice" });
    expect(own.thread).toBe(thread);
    await second.close();
    secondStore.close();
  });
});

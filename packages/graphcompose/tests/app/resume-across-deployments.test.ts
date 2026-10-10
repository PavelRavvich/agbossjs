import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemorySaver } from "@langchain/langgraph";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp, type AppOptions } from "../../src/app/create-app.js";
import { createMemoryPausedRunRepository } from "../../src/app/paused-runs.js";
import { createSqlitePausedRunRepository } from "../../src/app/sqlite-paused-runs.js";
import type { Class } from "../../src/components/injection.js";
import { createMemoryLedger } from "../../src/finops/ledger.js";
import { IncompatibleResumeError, NotPausedError } from "../../src/index.js";
import { createSqliteTernStore } from "../../src/terns/index.js";
import { callTool, replyWith } from "../../src/testing/index.js";
import { ScriptBook } from "../../src/testing/script-book.js";
import { createScriptedGateway } from "../../src/testing/scripted-gateway.js";
import {
  asked,
  MailV1,
  MailV2,
  MailV2Migrating,
  observed,
  SendEmail,
  sent,
  Start,
} from "./fixtures/mail.workflow.js";

const approve = { approved: true, by: "dana" };

/** One deployment's stores; `shared` ones outlive an app, like a database and a checkpointer. */
function storesOf(book: ScriptBook, shared: Pick<AppOptions, "stores" | "pausedRuns">) {
  return { processEnv: {}, gateway: createScriptedGateway(book), ...shared };
}

function scripted(): ScriptBook {
  const book = new ScriptBook();
  book
    .scriptOf("agent:mailer")
    .thenReturn(callTool(SendEmail, { to: "boss@example.com" }), replyWith("Sent."));
  return book;
}

/** Pauses a run on the first deployment, then builds `next` over the same stores. */
async function pauseThenDeploy(next: Class) {
  const book = scripted();
  const shared = {
    stores: {
      checkpointer: new MemorySaver(),
      terns: createSqliteTernStore(":memory:"),
      ledger: createMemoryLedger(),
    },
    pausedRuns: createMemoryPausedRunRepository(),
  };
  const v1 = await createApp(MailV1, storesOf(book, shared));
  const paused = await v1.execute(Start, { text: "Email the boss" });
  await v1.close();
  return { paused, next: await createApp(next, storesOf(book, shared)), shared, book };
}

beforeEach(() => {
  sent.length = 0;
  asked.length = 0;
  observed.length = 0;
});

describe("#201 AC1: a run paused under another workflow version is not resumed blindly", () => {
  it("resuming on a deployment with another config hash fails with IncompatibleResumeError naming both versions", async () => {
    const { paused, next } = await pauseThenDeploy(MailV2);

    const resumed = next.resume(paused.thread, approve);

    expect(paused.status).toBe("paused");
    await expect(resumed).rejects.toBeInstanceOf(IncompatibleResumeError);
    await expect(resumed).rejects.toMatchObject({
      code: "resume.incompatible",
      thread: paused.thread,
      paused: { workflowVersion: "1.0.0" },
      current: { workflowVersion: "2.0.0" },
    });
    await expect(resumed).rejects.toThrow(/paused under 1\.0\.0 .* this app runs 2\.0\.0/);
    expect(sent).toEqual([]);
  });

  it("a rejected resume leaves the run paused: a deployment that accepts it continues it", async () => {
    const { paused, next, shared, book } = await pauseThenDeploy(MailV2);
    await expect(next.resume(paused.thread, approve)).rejects.toThrow(IncompatibleResumeError);
    await next.close();

    const migrating = await createApp(MailV2Migrating, storesOf(book, shared));
    const done = await migrating.resume(paused.thread, approve);

    expect(done.status).toBe("answered");
    expect(done.output).toEqual({ text: "Sent." });
    expect(sent).toEqual(["boss@example.com"]);
  });

  it("with onIncompatibleResume returning 'resume' the run continues on the new graph", async () => {
    const { paused, next } = await pauseThenDeploy(MailV2Migrating);

    const done = await next.resume(paused.thread, approve);

    expect(done.status).toBe("answered");
    expect(done.output).toEqual({ text: "Sent." });
    expect(sent).toEqual(["boss@example.com"]);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      thread: paused.thread,
      paused: { workflowVersion: "1.0.0" },
      current: { workflowVersion: "2.0.0" },
    });
    expect(asked[0]?.paused.configHash).not.toBe(asked[0]?.current.configHash);
  });

  it("the same deployment restarted resumes without asking the policy", async () => {
    const { paused, next } = await pauseThenDeploy(MailV1);

    const done = await next.resume(paused.thread, approve);

    expect(done.output).toEqual({ text: "Sent." });
    expect(asked).toEqual([]);
  });
});

describe("#201 AC2: paused runs survive an app restart with durable stores", () => {
  /** A restart: every store re-opened from its file; only the checkpointer object is shared. */
  async function restartOn(pausedRuns: (db: string) => AppOptions["pausedRuns"]) {
    const db = join(mkdtempSync(join(tmpdir(), "gc-201-")), "terns.sqlite");
    const book = scripted();
    const checkpointer = new MemorySaver();
    const ledger = createMemoryLedger();
    const open = () => {
      const terns = createSqliteTernStore(db);
      return { stores: { checkpointer, ledger, terns }, pausedRuns: pausedRuns(db), terns };
    };
    const first = open();
    const app = await createApp(MailV1, storesOf(book, first));
    const paused = await app.execute(Start, { text: "Email the boss" });
    await app.close();
    first.terns.close();
    const second = open();
    return { db, paused, restarted: await createApp(MailV1, storesOf(book, second)) };
  }

  it("a run paused before the restart is resumed by the new process from the Tern database", async () => {
    const { db, paused, restarted } = await restartOn((file) =>
      createSqlitePausedRunRepository(file),
    );
    const record = await createSqlitePausedRunRepository(db).get(paused.thread);

    const done = await restarted.resume(paused.thread, approve);

    expect(paused.status).toBe("paused");
    expect(record).toMatchObject({
      workflowVersion: "1.0.0",
      run: { status: "paused", budgetUsd: Number.POSITIVE_INFINITY },
    });
    expect(await createSqlitePausedRunRepository(db).get(paused.thread)).toBeUndefined();
    expect(done.status).toBe("answered");
    expect(done.output).toEqual({ text: "Sent." });
    expect(sent).toEqual(["boss@example.com"]);
  });

  it("with the in-memory repository the restarted app does not know the paused run", async () => {
    const { paused, restarted } = await restartOn(() => createMemoryPausedRunRepository());

    await expect(restarted.resume(paused.thread, approve)).rejects.toBeInstanceOf(NotPausedError);
  });
});

describe("#246 AC3: an incompatible resume is the paused run's onError; the run stays paused", () => {
  it("onError(IncompatibleResumeError) with the paused run's id and thread, then a policy resumes it", async () => {
    const { paused, next, shared, book } = await pauseThenDeploy(MailV2);
    observed.length = 0;

    const refused = next.resume(paused.thread, approve);

    await expect(refused).rejects.toBeInstanceOf(IncompatibleResumeError);
    expect(observed).toEqual([
      {
        hook: "error",
        state: { runId: paused.runId, threadId: paused.thread },
        detail: await refused.catch((error: unknown) => error),
      },
    ]);
    await next.close();

    const migrating = await createApp(MailV2Migrating, storesOf(book, shared));
    const done = await migrating.resume(paused.thread, approve);

    expect(done).toMatchObject({ status: "answered", runId: paused.runId, thread: paused.thread });
    expect(sent).toEqual(["boss@example.com"]);
    expect(observed.map((event) => event.hook)).toEqual(["error"]);
  });
});

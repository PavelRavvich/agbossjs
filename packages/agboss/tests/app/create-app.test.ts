import { describe, expect, it } from "vitest";
import { createApp, NotAWorkflowStartError, type AppOptions } from "../../src/app/create-app.js";
import {
  Workflow,
  NotPausedError,
  from,
  GraphRuleError,
  WorkflowStart,
  type WorkflowDefinition,
  WorkflowSettings,
} from "../../src/index.js";
import { DtoValidationError, Text, WorkflowStartText } from "../../src/dto/index.js";
import { createMemoryLedger } from "../../src/finops/ledger.js";
import { createSqliteTernStore } from "../../src/terns/index.js";
import { replyWith, callTool, routeTo } from "../../src/testing/index.js";
import { McpStubs, stubbedMcpConnect } from "../../src/testing/mcp-stubs.js";
import { ScriptBook } from "../../src/testing/script-book.js";
import { createScriptedGateway } from "../../src/testing/scripted-gateway.js";
import { usd } from "../../src/units/index.js";
import {
  ChatStart,
  Desk,
  lifecycle,
  MainRouter,
  NotesServer,
  OrderBook,
  Reply,
  SaveNote,
  Support,
  Writer,
} from "../testing/fixtures/desk.workflow.js";
import { TerminalUserChannel } from "../../src/channels/terminal-channel.js";
import {
  CodeReview,
  Coder,
  PullRequest,
  Reviewer,
  ReviewGate,
  TaskStart,
} from "../testing/fixtures/code-review.workflow.js";

/** Everything external given: scripted models, memory stores, stubbed MCP servers. */
function offline(book: ScriptBook, stubs = new McpStubs(book)): AppOptions {
  return {
    processEnv: {},
    gateway: createScriptedGateway(book),
    stores: { terns: createSqliteTernStore(":memory:"), ledger: createMemoryLedger() },
    connectMcp: stubbedMcpConnect(stubs, new Map(), new Set()),
  };
}

class Ticket extends WorkflowStartText {
  @Text({ prompt: "the ticket id" })
  id!: string;
}

@WorkflowStart({ name: "ticket", description: "A helpdesk ticket", input: Ticket })
class TicketStart {
  declare readonly input: Ticket;
}

class NoLimits implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder().build();
  }
}

@Workflow({
  name: "two-starts",
  version: "1.0.0",
  flow: [
    from(TicketStart).next(Support),
    from(ChatStart).next(Writer),
    from(Support, Writer).next(Reply),
  ],
  defaults: {
    models: { temperature: 0, thinking: "default", cache: true },
    router: { kind: "jev", model: "typesafe/jev-1.13" },
    tools: { maxToolCalls: 2 },
    history: { limit: 2 },
  },
  channelClasses: [TerminalUserChannel],
  mcp: [NotesServer],
  providers: [OrderBook],
})
class TwoStarts extends NoLimits {}

@Workflow({
  name: "broken",
  version: "1.0.0",
  flow: [from(ChatStart).next(Writer), from(Support).next(Reply)],
  defaults: {
    models: { temperature: 0, thinking: "default", cache: true },
    router: { kind: "jev", model: "typesafe/jev-1.13" },
    tools: { maxToolCalls: 2 },
    history: { limit: 2 },
  },
})
class Broken extends NoLimits {}

describe("AC12: createApp — the real app", () => {
  it("assembles before any model call and reports every assembly error at once", async () => {
    const book = new ScriptBook();

    const built = createApp(Broken, offline(book));

    await expect(built).rejects.toBeInstanceOf(GraphRuleError);
    const codes = await built.catch((error: unknown) =>
      error instanceof GraphRuleError ? error.violations.map((item) => item.code) : [],
    );
    expect(codes).toEqual(expect.arrayContaining(["graph.dead-end", "graph.unreachable-node"]));
  });

  it("run returns thread, finish, output, path and spend", async () => {
    const book = new ScriptBook();
    book.scriptOf("agent:coder").thenReturn(replyWith("v1", { cost: usd(0.002) }));
    book.scriptOf("agent:reviewer").thenReturn(replyWith("clean"));
    book.scriptOf("router:review-gate").thenReturn(routeTo(PullRequest));
    const app = await createApp(CodeReview, offline(book));

    const result = await app.execute(TaskStart, { text: "Add a flag" });
    await app.close();

    expect(result).toMatchObject({
      finish: "pull-request",
      output: { text: "clean" },
      path: [TaskStart, Coder, Reviewer, ReviewGate, PullRequest],
      status: "answered",
    });
    expect(result.thread).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.spend.totalUsd).toBeCloseTo(0.002, 9);
    expect(app.textStart).toBe(TaskStart);
    expect([app.name, app.version, app.warnings]).toEqual(["code-review", "1.0.0", []]);
  });

  it("resume continues the paused run of a thread; a thread without a pause cannot resume", async () => {
    const book = new ScriptBook();
    const stubs = new McpStubs(book);
    stubs.stubOf("notes").thenReturn({ write_file: () => Promise.resolve({ content: "ok" }) });
    book.scriptOf("router:main").thenReturn(routeTo(Support));
    book
      .scriptOf("agent:support")
      .thenReturn(callTool(SaveNote, { title: "a", text: "b" }), replyWith("Saved."));
    const app = await createApp(Desk, offline(book, stubs));

    const paused = await app.execute(ChatStart, { text: "save a note" });
    const done = await app.resume(paused.thread, { approved: true, by: "dana" });

    expect(paused).toMatchObject({
      status: "paused",
      pause: { agent: "support", tool: "save_note" },
    });
    expect(paused.path).toEqual([ChatStart, MainRouter, Support]);
    expect(done).toMatchObject({
      finish: "reply",
      output: { text: "Saved." },
      thread: paused.thread,
    });
    await expect(app.resume(paused.thread, { approved: true, by: "dana" })).rejects.toBeInstanceOf(
      NotPausedError,
    );
    await app.close();
  });

  it("close runs onStop of the components it started, once", async () => {
    lifecycle.length = 0;
    const app = await createApp(Desk, offline(new ScriptBook()));
    const started = [...lifecycle];

    await app.close();
    await app.close();

    expect(started).toEqual(["OrderBook.onStart"]);
    expect(lifecycle).toEqual(["OrderBook.onStart", "OrderBook.onStop"]);
  });

  it("checks the start and its input DTO before any call", async () => {
    const book = new ScriptBook();
    const app = await createApp(CodeReview, offline(book));

    await expect(app.execute(ChatStart, { text: "hi" })).rejects.toBeInstanceOf(
      NotAWorkflowStartError,
    );
    // @ts-expect-error -- Reply is not a @WorkflowStart, so tsc rejects it; this pins the runtime guard
    await expect(app.execute(Reply, { text: "hi" })).rejects.toThrow(
      'Reply is not a workflow start of "code-review"',
    );
    await expect(app.execute(TaskStart, { text: "" })).rejects.toBeInstanceOf(DtoValidationError);
    expect(book.scriptOf("agent:coder").requests).toEqual([]);
    await app.close();
  });

  it("with several workflow starts, the run starts at the one asked for", async () => {
    const book = new ScriptBook();
    book.scriptOf("agent:support").thenReturn(replyWith("ticket"));
    book.scriptOf("agent:writer").thenReturn(replyWith("chat"));
    const app = await createApp(TwoStarts, offline(book));

    const ticket = await app.execute(TicketStart, { text: "printer broken", id: "T-1" });
    const chat = await app.execute(ChatStart, { text: "hi" });
    await app.close();

    expect(ticket).toMatchObject({
      output: { text: "ticket" },
      path: [TicketStart, Support, Reply],
    });
    expect(chat).toMatchObject({ output: { text: "chat" }, path: [ChatStart, Writer, Reply] });
    expect(app.textStart).toBe(ChatStart);
  });
});

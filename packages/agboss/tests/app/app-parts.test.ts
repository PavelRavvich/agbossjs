import { describe, expect, it, vi } from "vitest";
import { createAppDeps } from "../../src/app/app-deps.js";
import { createApp } from "../../src/app/create-app.js";
import { toolLookup, UnknownToolError } from "../../src/app/parts.js";
import { flowNodesByKey, runResultOf } from "../../src/app/result.js";
import { workflowOf } from "../../src/testing/index.js";
import {
  Workflow,
  from,
  WorkflowSettings,
  WorkflowStart,
  type WorkflowDefinition,
} from "../../src/index.js";
import { Text, WorkflowStartText } from "../../src/dto/index.js";
import { buildCostReport } from "../../src/finops/usage.js";
import { createMemoryLedger } from "../../src/finops/ledger.js";
import { createSqliteTernStore } from "../../src/terns/index.js";
import { ScriptBook } from "../../src/testing/script-book.js";
import { createScriptedGateway } from "../../src/testing/scripted-gateway.js";
import { CodeReview, Coder, TaskStart } from "../testing/fixtures/code-review.workflow.js";
import { Desk, OrderBook, Reply, Writer } from "../testing/fixtures/desk.workflow.js";

const offline = () => ({
  gateway: createScriptedGateway(new ScriptBook()),
  stores: { terns: createSqliteTernStore(":memory:"), ledger: createMemoryLedger() },
});

class Ticket extends WorkflowStartText {
  @Text({ prompt: "the ticket id" })
  id!: string;
}

@WorkflowStart({ name: "ticket", description: "A ticket", input: Ticket })
class TicketStart {
  declare readonly input: Ticket;
}

@Workflow({
  name: "tickets",
  version: "1.0.0",
  flow: [from(TicketStart).next(Writer), from(Writer).next(Reply)],
  defaults: {
    models: { temperature: 0, thinking: "default", cache: true },
    router: { kind: "jev", model: "typesafe/jev-1.13" },
    tools: { maxToolCalls: 1 },
    history: { limit: 1 },
  },
  providers: [OrderBook],
})
class Tickets implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder().build();
  }
}

describe("AC12: the app's parts", () => {
  it("an unknown tool name is a wiring bug", () => {
    expect(() => toolLookup([])("nope")).toThrow(UnknownToolError);
  });

  it("a run's result keeps memory and trace link; unknown path keys are skipped", async () => {
    const nodes = flowNodesByKey((await workflowOf(CodeReview)).flow);
    const result = runResultOf(
      {
        status: "answered",
        replyWith: "ok",
        route: ["coder"],
        path: ["workflow-start.task", "coder", "gone"],
        stopReason: "done",
        budgetUsd: 1,
        cost: buildCostReport([]),
        threadId: "t",
        ternId: "tern",
        runId: "r",
        compacted: { fromTurn: 1, toTurn: 5, summaries: 1, keep: 10 },
        traceUrl: "http://traces/t",
      },
      nodes,
    );

    expect(result.path).toEqual([TaskStart, Coder]);
    expect(result).toMatchObject({ traceUrl: "http://traces/t", compacted: { keep: 10 } });
  });

  it("with no text start, a plain text goes to the first start", async () => {
    const app = await createApp(Tickets, offline());

    expect(app.textStart).toBe(TicketStart);
    await app.close();
  });

  it("the container reports every instance it creates, besides the app's own lifecycle", async () => {
    const onCreate = vi.fn();
    const noMcp = () => Promise.resolve({ close: () => Promise.resolve() });

    const deps = await createAppDeps(await workflowOf(Desk), {
      ...offline(),
      connectMcp: noMcp,
      container: { onCreate },
    });
    await deps.close();

    expect(onCreate).toHaveBeenCalledWith(expect.any(OrderBook));
  });

  it("env defaults to the process's; a bundle without server tools connects none", async () => {
    const bundle = { ...(await workflowOf(Tickets)), serverTools: undefined };

    const deps = await createAppDeps(bundle, offline());
    await deps.close();

    expect(deps.knowledge).toBeUndefined();
  });

  it("context knowledge bases are looked up per agent; an agent without any gets none", async () => {
    const bundle = { ...(await workflowOf(Tickets)), knowledge: () => new Map([["writer", []]]) };

    const deps = await createAppDeps(bundle, offline());
    await deps.close();

    expect(deps.knowledge?.("writer")).toEqual([]);
    expect(deps.knowledge?.("someone")).toEqual([]);
  });
});

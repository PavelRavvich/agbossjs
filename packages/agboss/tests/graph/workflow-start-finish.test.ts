import { describe, expect, it } from "vitest";
import { WorkflowStartText, Text, WorkflowFinishText } from "../../src/dto/index.js";
import { workflowFinishMetaOf } from "../../src/graph/workflow-finish.decorator.js";
import { WorkflowStart, workflowStartMetaOf } from "../../src/graph/workflow-start.decorator.js";
import { from, type Flow } from "../../src/graph/flow.js";
import { nodeInfoOf } from "../../src/graph/node-kind.js";
import { runAgent } from "../../src/index.js";
import { Alpha, Beta, TestAnswer, TestChat } from "../fixtures/test-flow/test.flow.js";
import { fakeDeps } from "../helpers.js";

/** A second workflow start: a ticket from a helpdesk webhook (still a chat message for now). */
class Ticket extends WorkflowStartText {
  @Text({ prompt: "the ticket id" })
  id!: string;
}

@WorkflowStart({ name: "ticket", description: "A helpdesk ticket", input: Ticket })
class TicketWorkflowStart {
  declare readonly input: Ticket;
}

/** Each workflow start leads to its own agent. */
const twoStarts: Flow = [
  from(TestChat).next(Alpha),
  from(TicketWorkflowStart).next(Beta),
  from(Alpha, Beta).next(TestAnswer),
];

describe("AC1: minimal @WorkflowStart and @WorkflowFinish", () => {
  it("mark classes as workflow start and workflow finish nodes, with their options", () => {
    expect(nodeInfoOf(TestChat)).toEqual({ kind: "workflow-start", name: "chat" });
    expect(nodeInfoOf(TestAnswer)).toEqual({ kind: "workflow-finish", name: "replyWith" });
    expect(workflowStartMetaOf(TestChat)?.input).toBe(WorkflowStartText);
    expect(workflowFinishMetaOf(TestAnswer)?.output).toBe(WorkflowFinishText);
  });

  it("with several workflow starts, the run starts at the one asked for; a plain task goes to the chat workflow start", async () => {
    const deps = {
      ...fakeDeps({ "test/alpha": ["chat"], "test/beta": ["ticket"] }),
      flow: twoStarts,
    };

    const ticket = await runAgent({ task: "printer broken", start: "ticket" }, deps);
    const chat = await runAgent({ task: "hi" }, deps);

    expect(ticket).toMatchObject({ replyWith: "ticket", route: ["beta"], finish: "replyWith" });
    expect(chat).toMatchObject({ replyWith: "chat", route: ["alpha"], finish: "replyWith" });
  });
});

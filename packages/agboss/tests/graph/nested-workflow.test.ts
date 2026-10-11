import { describe, expect } from "vitest";
import { workflowOf } from "../../src/components/assemble.js";
import { callTool, replyWith, testWith } from "../../src/testing/index.js";
import { toolResultsOf } from "../testing/fixtures/requests.js";
import {
  Booker,
  Booking,
  ChildDone,
  ChildStart,
  ClashingParent,
  ConflictingParent,
  Done,
  Drafter,
  Greet,
  Greeter,
  GreetingWorkflow,
  Parent,
  Payer,
  Start,
  undone,
} from "./fixtures/nested.js";

const parent = testWith(Parent);
const booking = testWith(Booking);

describe("#189: a nested workflow runs as a subgraph that returns only its delta", () => {
  parent(
    "usage equals the real model calls and the path has no repeats (AC1)",
    async ({ app, mockLlm }) => {
      mockLlm(Drafter).thenReturn(replyWith("draft"));
      mockLlm(Greeter).thenReturn(replyWith("Hello, draft"));

      const result = await app.execute(Start, { text: "hi" });

      expect(result.status).toBe("answered");
      expect(result.replyWith).toBe("Hello, draft");
      expect(result.spend.calls).toBe(2);
      expect(result.spend.trace).toHaveLength(2);
      expect(result.path).toEqual([
        Start,
        Drafter,
        GreetingWorkflow,
        ChildStart,
        Greeter,
        ChildDone,
        Done,
      ]);
    },
  );

  parent(
    "mockLlm of the child's agent works in the parent's test (AC2)",
    async ({ app, mockLlm }) => {
      mockLlm(Drafter).thenReturn(replyWith("draft"));
      mockLlm(Greeter).thenReturn(replyWith("scripted child"));

      const result = await app.execute(Start, { text: "hi" });

      expect(result.replyWith).toBe("scripted child");
      expect(mockLlm(Greeter)).toHaveBeenAskedWith({ input: "hi" });
    },
  );

  parent("the child's own provider reaches the child's tools (AC3)", async ({ app, mockLlm }) => {
    mockLlm(Drafter).thenReturn(replyWith("draft"));
    mockLlm(Greeter).thenReturn(callTool(Greet, { who: "Ann" }), replyWith("done"));

    await app.execute(Start, { text: "hi" });

    expect(toolResultsOf(mockLlm(Greeter).lastRequest)).toEqual(['{"text":"Hello, Ann"}']);
  });
});

describe("#189: the child's module joins the parent's", () => {
  parent("a token registered differently in parent and child fails at assembly", async () => {
    await expect(workflowOf(ConflictingParent)).rejects.toThrow(
      /\[di\.duplicate-token\] GREETING is registered differently by @Workflow "conflicting-parent" and its nested @Workflow "greeting"/,
    );
  });

  parent("one node name for two agent classes in parent and child fails at assembly", async () => {
    await expect(workflowOf(ClashingParent)).rejects.toThrow(/\[workflow\.duplicate-node\]/);
  });
});

describe("#189: compensating with a workflow runs that workflow's own flow", () => {
  booking(
    "the undo workflow's action runs; the parent's flow is not rerun",
    async ({ app, mockLlm }) => {
      undone.length = 0;
      mockLlm(Booker).thenReturn(replyWith("booked"));
      mockLlm(Payer).thenAnswer(() => {
        throw new Error("card declined");
      });

      const result = await app.execute(Start, { text: "book" });

      expect(undone).toEqual(["undo-booking"]);
      expect(mockLlm(Booker).requests).toHaveLength(1);
      expect(result.path).toContain(Done);
    },
  );
});

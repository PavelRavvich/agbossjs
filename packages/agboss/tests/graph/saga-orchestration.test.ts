import { describe, expect, it, vi } from "vitest";
import { Agent, WorkflowAction, Workflow } from "../../src/components/decorators.js";
import { from, catchError, WorkflowStart, WorkflowFinish } from "../../src/index.js";
import { LocalSagaStrategy } from "../../src/core/saga/local-saga.strategy.js";
import { testWith } from "../../src/testing/test-with.js";
import { replyWith } from "../../src/testing/script.js";

const logs: string[] = [];

@WorkflowAction({ name: "cancel-payment" })
class CancelPaymentAction {
  async execute() {
    logs.push("cancel_payment");
    return { payload: { canceled: true } };
  }
}

@WorkflowAction({ name: "cancel-hotel" })
class CancelHotelAction {
  async execute() {
    logs.push("cancel_hotel");
    return { payload: { hotel_canceled: true } };
  }
}

@Agent({
  name: "book-hotel",
  model: "gpt-4",
  description: "b",
  prompt: "p",
  compensate: CancelHotelAction,
})
class BookHotelAgent {}

@Agent({
  name: "process-payment",
  model: "gpt-4",
  description: "p",
  prompt: "p",
  compensate: CancelPaymentAction,
})
class ProcessPaymentAgent {}

@Agent({ name: "book-flight", model: "gpt-4", description: "b", prompt: "p" }) // Fails intentionally
class BookFlightAgent {}

import { WorkflowStartText, WorkflowFinishText } from "../../src/dto/standard/framework.js";
@WorkflowStart({ name: "Start", description: "Start", input: WorkflowStartText })
class Start {
  declare readonly input: WorkflowStartText;
}
@WorkflowFinish({ name: "Finish", description: "Finish", output: WorkflowFinishText })
class Finish {}

@Workflow({
  name: "vacation-booking",
  version: "1.0.0",
  providers: [
    Start,
    Finish,
    BookHotelAgent,
    ProcessPaymentAgent,
    BookFlightAgent,
    LocalSagaStrategy,
    CancelHotelAction,
    CancelPaymentAction,
  ],
  flow: [
    from(Start).next(BookHotelAgent),
    from(BookHotelAgent).next(ProcessPaymentAgent),
    from(ProcessPaymentAgent).next(BookFlightAgent),
    // Route any error in book_flight to LocalSagaStrategy to trigger rollbacks
    catchError(BookFlightAgent, Error).compensateWith(LocalSagaStrategy),
    from(LocalSagaStrategy).next(Finish),
  ],
  defaults: {
    models: { temperature: 0, maxTokens: 1000, thinking: "default", cache: true },
    router: { kind: "llm", model: "openrouter:openai/gpt-4" },
    tools: { maxToolCalls: 8 },
    history: { limit: 5 },
  },
})
class VacationBookingWorkflow {
  settings = () =>
    ({
      limits: { steps: 50 },
      models: {} as any,
    }) as unknown as import("../../src/graph/settings.js").WorkflowSettings;
}

const test = testWith(VacationBookingWorkflow);

describe("Saga Orchestration", () => {
  const test = testWith(VacationBookingWorkflow);
  test("executes compensators in reverse order upon failure", async ({ app, mockLlm }) => {
    logs.length = 0;
    // Mock the agents to just execute and not actually call LLM
    mockLlm(BookHotelAgent).thenAnswer(() => {
      logs.push("book_hotel");
      return replyWith("ok", { payload: { step: 1 } } as any);
    });
    mockLlm(ProcessPaymentAgent).thenAnswer(() => {
      logs.push("process_payment");
      return replyWith("ok", { payload: { step: 2 } } as any);
    });
    mockLlm(BookFlightAgent).thenAnswer(() => {
      throw new Error("Flight fully booked");
    });

    const res = await app.execute(Start, { text: "hello" });
    expect(res.status).toBe("answered");

    // Expected execution order:
    // 1. book_hotel
    // 2. process_payment
    // 3. Error in book_flight -> routed to LocalSagaStrategy
    // 4. LocalSagaStrategy finds book_hotel and process_payment in history
    // 5. Compensates in reverse: cancel_payment -> cancel_hotel

    expect(logs).toEqual(["book_hotel", "process_payment", "cancel_payment", "cancel_hotel"]);
  });
});

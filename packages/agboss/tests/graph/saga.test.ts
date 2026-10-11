import { describe, expect, it } from "vitest";
import { Agent, Workflow } from "../../src/components/decorators.js";
import { from, catchError, WorkflowStart, WorkflowFinish } from "../../src/index.js";

import { testWith } from "../../src/testing/test-with.js";
import { replyWith } from "../../src/testing/script.js";

class MockTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MockTimeoutError";
  }
}

@Agent({ name: "cancel_flight", model: "gpt-4", description: "c", prompt: "p" })
class CancelFlightAgent {}

@Agent({
  name: "book_flight",
  model: "gpt-4",
  description: "b",
  prompt: "p",
  compensate: CancelFlightAgent,
})
class BookFlightAgent {}

@Agent({ name: "fallback_agent", model: "gpt-4", description: "f", prompt: "p" })
class FallbackAgent {}

import { WorkflowStartText } from "../../src/dto/standard/framework.js";
@WorkflowStart({ name: "Start", description: "Start", input: WorkflowStartText })
class Start {
  declare readonly input: WorkflowStartText;
}
@WorkflowFinish({ name: "Finish", description: "Finish", output: WorkflowStartText })
class Finish {}

@Workflow({
  name: "trip-booking",
  version: "1.0.0",
  providers: [Start, Finish, BookFlightAgent, FallbackAgent],
  flow: [
    from(Start).next(BookFlightAgent),
    catchError(BookFlightAgent, MockTimeoutError).next(FallbackAgent),
    catchError(BookFlightAgent, Error).next(Finish),
    from(FallbackAgent).next(Finish),
  ],
  defaults: {
    models: { temperature: 0, maxTokens: 1000, thinking: "default", cache: true },
    router: { kind: "llm", model: "openrouter:openai/gpt-4" },
    tools: { maxToolCalls: 8 },
    history: { limit: 5 },
  },
})
class TripBookingWorkflow {
  settings = () =>
    ({
      limits: { steps: 50 },
      models: {} as any,
    }) as unknown as import("../../src/graph/settings.js").WorkflowSettings;
}

const test = testWith(TripBookingWorkflow);

describe("Saga and Error Routing", () => {
  test("routes to WorkflowFinish on generic error", async ({ app, mockLlm }) => {
    mockLlm(BookFlightAgent).thenAnswer(() => {
      throw new Error("Database down");
    });

    const res = await app.execute(Start, { text: "hello" });
    expect(res.status).toBe("answered");

    expect(mockLlm(BookFlightAgent).requests.length).toBe(1);
    expect(mockLlm(FallbackAgent).requests.length).toBe(0);
  });

  test("routes to fallback on specific error", async ({ app, mockLlm }) => {
    mockLlm(BookFlightAgent).thenAnswer(() => {
      throw new MockTimeoutError("Flight API down");
    });
    mockLlm(FallbackAgent).thenAnswer(() => replyWith('{"recovered": true}'));

    const res = await app.execute(Start, { text: "hello" });
    expect(res.status).toBe("answered");

    expect(mockLlm(BookFlightAgent).requests.length).toBe(1);
    expect(mockLlm(FallbackAgent).requests.length).toBe(1);
  });
});

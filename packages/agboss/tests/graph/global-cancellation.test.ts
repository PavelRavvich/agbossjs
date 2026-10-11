import { describe, expect, it } from "vitest";
import { Agent, WorkflowAction, Workflow } from "../../src/components/decorators.js";
import { from, catchError, WorkflowStart, WorkflowFinish } from "../../src/index.js";
import { LocalSagaStrategy } from "../../src/core/saga/local-saga.strategy.js";
import { WorkflowCancelledError } from "../../src/core/errors.js";
import { testWith } from "../../src/testing/test-with.js";
import { replyWith } from "../../src/testing/script.js";

const logs: string[] = [];

@WorkflowAction({ name: "cancel-payment-global" })
class CancelPaymentAction {
  async execute(state: any, ctx: any) {
    logs.push(`cancel_payment:${String(ctx.idempotencyKey)}`);
    return { payload: { canceled: true } };
  }
}

@Agent({
  name: "process-payment-global",
  model: "gpt-4",
  description: "Process",
  prompt: "p",
  compensate: CancelPaymentAction,
})
class ProcessPaymentAgent {}

@Agent({ name: "slow-agent", model: "gpt-4", description: "Slow", prompt: "p" })
class SlowAgent {}

import { WorkflowStartText, WorkflowFinishText } from "../../src/dto/standard/framework.js";
@WorkflowStart({ name: "Start", description: "Start", input: WorkflowStartText })
class Start {
  declare readonly input: WorkflowStartText;
}
@WorkflowFinish({ name: "Finish", description: "Finish", output: WorkflowFinishText })
class Finish {}

@Workflow({
  name: "cancellable-booking",
  version: "1.0.0",
  providers: [
    Start,
    Finish,
    ProcessPaymentAgent,
    SlowAgent,
    LocalSagaStrategy,
    CancelPaymentAction,
  ],
  flow: [
    from(Start).next(ProcessPaymentAgent),
    from(ProcessPaymentAgent).next(SlowAgent),
    from(SlowAgent).next(Finish),
    // Catch global cancellation and rollback
    catchError(SlowAgent, WorkflowCancelledError).compensateWith(LocalSagaStrategy),
    from(LocalSagaStrategy).next(Finish),
  ],
  defaults: {
    models: { temperature: 0, maxTokens: 1000, thinking: "default", cache: true },
    router: { kind: "llm", model: "openrouter:openai/gpt-4" },
    tools: { maxToolCalls: 8 },
    history: { limit: 5 },
  },
})
class CancellableBookingWorkflow {
  settings = () =>
    ({
      limits: { steps: 50 },
      models: {} as any,
    }) as unknown as import("../../src/graph/settings.js").WorkflowSettings;
}

const test = testWith(CancellableBookingWorkflow);

describe("Global Cancellation", () => {
  test("cancels execution and triggers rollback with idempotency keys", async ({
    app,
    mockLlm,
  }) => {
    logs.length = 0;
    // Mock ProcessPayment
    mockLlm(ProcessPaymentAgent).thenAnswer(() => {
      logs.push("process_payment");
      return replyWith("ok");
    });

    // We will intercept the slow agent and cancel the app
    mockLlm(SlowAgent).thenAnswer(() => {
      logs.push("slow_agent_started");
      // We trigger the global cancel api while the agent is "running"
      void app.cancel("run-0");
      // We throw so it fails and router catches it (simulating what the guard does if it hits on next tick)
      throw new WorkflowCancelledError();
    });

    const res = await app.execute(Start, { text: "hello" });
    expect(res.status).toBe("answered"); // completes successfully because LocalSaga handles the error

    // Expected execution order:
    // 1. process_payment
    // 2. slow_agent_started -> triggers cancel -> throws CancelledError
    // 3. LocalSagaStrategy executes CancelPaymentAction

    expect(logs).toContain("process_payment");
    expect(logs).toContain("slow_agent_started");

    const cancelLog = logs.find((l) => l.startsWith("cancel_payment:"));
    expect(cancelLog).toBeDefined();
    expect(cancelLog).toMatch(/^cancel_payment:run-\d+:process-payment-global$/);
  });
});

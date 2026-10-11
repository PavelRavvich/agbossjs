import { describe, it, expect, vi } from "vitest";
import { Workflow, Agent, WorkflowAction } from "../../src/components/decorators.js";
import { from, catchError } from "../../src/graph/flow.js";
import { SagaOrchestrator } from "../../src/core/saga.js";
import { testWith } from "../../src/testing/test-with.js";

const compensationFn = vi.fn();
const actionCompensationFn = vi.fn();
const failingActionFn = vi.fn();

@Agent({ name: "CancelFlightAgent", prompt: "Cancel flight" })
class CancelFlightAgent {}

@Agent({ name: "BookFlightAgent", prompt: "Book flight", compensate: CancelFlightAgent })
class BookFlightAgent {}

@WorkflowAction({ name: "CancelHotelAction" })
class CancelHotelAction {
  execute() {
    actionCompensationFn();
    return {};
  }
}

@WorkflowAction({ name: "BookHotelAction", compensate: CancelHotelAction })
class BookHotelAction {
  execute() {
    return {};
  }
}

@WorkflowAction({ name: "FailingAction" })
class FailingAction {
  execute() {
    failingActionFn();
    throw new Error("Failing");
  }
}

@Workflow({
  name: "SagaTestWorkflow",
  flow: [
    from(BookFlightAgent).next(BookHotelAction),
    from(BookHotelAction).next(FailingAction),
    catchError(FailingAction, Error).next(SagaOrchestrator),
    from(SagaOrchestrator).next("end"),
  ],
})
class SagaTestWorkflow {}

describe("Saga Orchestrator", () => {
  it("should rollback agents and actions in reverse order", async () => {
    await testWith(SagaTestWorkflow, async ({ app, when, replyWith }) => {
      when(BookFlightAgent).thenAnswer(() => replyWith("Flight booked"));
      when(CancelFlightAgent).thenAnswer(() => {
        compensationFn();
        return replyWith("Flight canceled");
      });

      const res = await app.invoke({ task: "Book my trip" });

      expect(failingActionFn).toHaveBeenCalled();
      expect(actionCompensationFn).toHaveBeenCalled(); // Hotel canceled
      expect(compensationFn).toHaveBeenCalled(); // Flight canceled

      // Ensure error is cleared by SAGA
      expect(res.lastError).toBeNull();
    });
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  WorkflowAction,
  type IWorkflowAction,
  type ActionRuntime,
  Agent,
} from "../../src/components/decorators.js";
import { from, type Flow } from "../../src/graph/flow.js";
import { runAgent } from "../../src/index.js";
import { TestAnswer, TestChat } from "../fixtures/test-flow/test.flow.js";
import { fakeDeps } from "../helpers.js";
import type { AgentState, AgentStateUpdate } from "../../src/graph/state.js";

// --- Fixtures ---

@Agent({ name: "alpha", description: "Does something before action", model: "stub" })
class AlphaAgent {}

@Agent({ name: "beta", description: "Does something after action", model: "stub" })
class BetaAgent {}

// Spies for actions
const syncActionSpy = vi.fn();
const parallelActionSpy = vi.fn();

@WorkflowAction({ name: "sync-db", description: "Sync data to database" })
class SyncDbAction implements IWorkflowAction<{ data: string; asyncCount: number }> {
  async execute(
    state: AgentState<{ data: string; asyncCount: number }>,
    context: ActionRuntime,
  ): Promise<Partial<AgentStateUpdate>> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    syncActionSpy(state.payload?.data);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return { payload: { ...state.payload, data: (state.payload?.data || "") + " (synced)" } };
  }
}

@WorkflowAction({ name: "notify-analytics", description: "Send metrics" })
class NotifyAction implements IWorkflowAction<{ data: string; asyncCount: number }> {
  async execute(
    state: AgentState<{ data: string; asyncCount: number }>,
    context: ActionRuntime,
  ): Promise<Partial<AgentStateUpdate>> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    parallelActionSpy(state.payload?.asyncCount);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return { payload: { ...state.payload, asyncCount: (state.payload?.asyncCount || 0) + 1 } };
  }
}

const actionFlow: Flow = [
  from(TestChat).next(AlphaAgent),
  from(AlphaAgent).next(SyncDbAction),
  from(SyncDbAction).next(BetaAgent),
  from(BetaAgent).next(TestAnswer),
];

const parallelFlow: Flow = [
  from(TestChat).nextParallel(AlphaAgent, NotifyAction),
  from(AlphaAgent, NotifyAction).next(TestAnswer),
];

// --- Tests ---

describe("@WorkflowAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const actionsResolver = (name: string) => {
    if (name === "sync-db") return new SyncDbAction();
    if (name === "notify-analytics") return new NotifyAction();
    throw new Error(`Unknown action: ${name}`);
  };

  it("executes the action sequentially within the graph, updating state", async () => {
    const deps = {
      ...fakeDeps({ "test/alpha": ["hello"], "test/beta": ["done"] }),
      flow: actionFlow,
      actions: actionsResolver,
    };

    const run = await runAgent({ task: "start" }, deps);

    expect(syncActionSpy).toHaveBeenCalled();
    expect(run.route).toEqual(["alpha", "beta"]); // Actions are not recorded in "route" since they are not agents!
    expect(run.finish).toBe("replyWith");
  });

  it("can execute an action in parallel with an agent", async () => {
    const deps = {
      ...fakeDeps({ "test/alpha": ["done"] }),
      flow: parallelFlow,
      actions: actionsResolver,
    };

    const run = await runAgent({ task: "start" }, deps);

    expect(parallelActionSpy).toHaveBeenCalled();
    expect(run.route).toEqual(["alpha"]);
    expect(run.finish).toBe("replyWith");
  });
});

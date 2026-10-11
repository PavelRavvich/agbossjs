import { describe, it, expect } from "vitest";
import { Workflow, Agent, Tool } from "../../../src/components/decorators.js";
import {
  from,
  WorkflowStart,
  WorkflowFinish,
  type WorkflowDefinition,
} from "../../../src/index.js";
import { testWith } from "../../../src/testing/test-with.js";
import { QuorumRouter, type QuorumStrategy } from "../../../src/concurrency/quorum.decorator.js";
import { replyWith } from "../../../src/testing/script.js";

@Tool({
  name: "slow_tool",
  description: "A slow tool",
  input: WorkflowStartText,
  output: WorkflowStartText,
})
class SlowTool {
  run = async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { text: "ok" };
  };
}

@Tool({
  name: "fast_tool",
  description: "A fast tool",
  input: WorkflowStartText,
  output: WorkflowStartText,
})
class FastTool {
  run = async () => {
    return { text: "ok" };
  };
}

@Agent({
  name: "fast_agent",
  model: "gpt-4",
  description: "Fast",
  prompt: "You are fast",
  tools: [FastTool],
})
class FastAgent {}

@Agent({
  name: "slow_agent",
  model: "gpt-4",
  description: "Slow",
  prompt: "You are slow",
  tools: [SlowTool],
})
class SlowAgent {}

@QuorumRouter({ name: "quorum_router" })
class MyQuorumRouter implements QuorumStrategy {
  filterVote(state: any) {
    return true;
  }
  route(state: any, hasQuorum: boolean): any {
    return Finish;
  }
}

import { WorkflowStartText } from "../../../src/dto/standard/framework.js";
@WorkflowStart({ name: "Start", description: "Start", input: WorkflowStartText })
class Start {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "Finish", description: "Finish", output: WorkflowStartText })
class Finish {}

@Workflow({
  name: "quorum-test",
  version: "1.0.0",
  providers: [Start, Finish, FastAgent, SlowAgent, MyQuorumRouter],
  flow: [
    from(Start).nextParallel(FastAgent, SlowAgent),
    from(FastAgent, SlowAgent).joinQuorum(MyQuorumRouter, { min: 1 }).routes(Finish),
  ],
  defaults: {
    models: { temperature: 0, maxTokens: 1000, thinking: "default", cache: true },
    router: { kind: "llm", model: "openrouter:openai/gpt-4" },
    tools: { maxToolCalls: 8 },
    history: { limit: 5 },
  },
})
class QuorumTestWorkflow implements WorkflowDefinition {
  settings = () =>
    ({
      limits: { steps: 50 },
      models: {} as any,
    }) as unknown as import("../../../src/graph/settings.js").WorkflowSettings;
}

const test = testWith(QuorumTestWorkflow);

describe("QuorumRouter", () => {
  test("aborts the slower branch when the quorum is met, saving an LLM call", async ({
    app,
    mockLlm,
  }) => {
    mockLlm(FastAgent).thenReturn(replyWith("{}"));
    mockLlm(SlowAgent).thenReturn(
      { kind: "tool-call", tool: "slow_tool", args: { text: "hello" } },
      replyWith("{}"),
    );

    await app.execute(Start, { text: "hello" });

    expect(mockLlm(FastAgent).requests.length).toBe(1);
    expect(mockLlm(SlowAgent).requests.length).toBe(1); // It made the tool call, but was aborted before the second call
  });
});

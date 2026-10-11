import { describe, expect, it } from "vitest";
import { createApp, type AppOptions } from "../../../src/app/create-app.js";
import { Agent, Workflow, Tool } from "../../../src/components/decorators.js";
import { ScriptBook } from "../../../src/testing/script-book.js";
import { createScriptedGateway } from "../../../src/testing/scripted-gateway.js";
import { createMemoryLedger } from "../../../src/finops/ledger.js";
import { createSqliteTernStore } from "../../../src/terns/index.js";
import { callTool, replyWith } from "../../../src/testing/index.js";
import type { ToolContext } from "../../../src/tools/index.js";
import { WorkflowPauseQuestion, WorkflowPauseAnswer } from "../../../src/dto/standard/framework.js";
import {
  WorkflowSettings,
  type WorkflowDefinition,
  chain,
  from,
  parallel,
  optional,
  WorkflowStart,
  WorkflowFinish,
  Router,
} from "../../../src/index.js";
import { WorkflowStartText, WorkflowFinishText } from "../../../src/dto/index.js";
import { createMemoryPausedRunRepository } from "../../../src/app/paused-runs.js";

@WorkflowStart({ name: "start", description: "Start", input: WorkflowStartText })
class Start {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "finish", description: "Finish", output: WorkflowFinishText })
class Finish {}

@Tool({
  name: "ask",
  description: "ask user",
  input: WorkflowPauseQuestion,
  output: WorkflowPauseAnswer,
})
class AskTool {
  run(input: WorkflowPauseQuestion, ctx: ToolContext): Promise<WorkflowPauseAnswer> {
    const response = ctx.pause(input) as string;
    const ans = new WorkflowPauseAnswer();
    ans.replyWith = response;
    return Promise.resolve(ans);
  }
}

@Agent({ name: "agentA", description: "fast agent", prompt: "Just replyWith.", model: "stub" })
class AgentA {}

@Agent({
  name: "agentB",
  description: "slow agent",
  prompt: "Use ask tool.",
  tools: [AskTool],
  model: "stub",
})
class AgentB {}

@Router({
  name: "router",
  description: "router",
  prompt: "choose",
  routes: [{ prompt: "do both", target: parallel(AgentA, optional(AgentB)) }],
  model: "stub",
})
class TestRouter {}

@Workflow({
  name: "test-parallel",
  version: "1.0",
  defaults: {
    models: { maxTokens: 100, temperature: 0 },
    history: { limit: 1 },
    tools: { maxToolCalls: 1 },
    router: { kind: "llm", model: "stub" },
  },
  flow: [
    from(Start).next(TestRouter),
    from(TestRouter).routes(),
    from(AgentA, AgentB).join(Finish),
  ],
})
class ParallelFlow implements WorkflowDefinition {
  settings() {
    return WorkflowSettings.builder().build();
  }
}

function offline(book: ScriptBook): AppOptions {
  return {
    processEnv: {},
    gateway: createScriptedGateway(book),
    stores: { terns: createSqliteTernStore(":memory:"), ledger: createMemoryLedger() },
    pausedRuns: createMemoryPausedRunRepository(),
  };
}

describe("Ticket 174: Parallel routing with Human-in-the-loop pauses", () => {
  it("should run parallel branches, one hitting a pause, and merge them on resume", async () => {
    const book = new ScriptBook();
    book.scriptOf("router:router").thenReturn(replyWith("parallel(agentA, optional(agentB))"));
    book.scriptOf("agent:agentA").thenReturn(replyWith("done A"));
    book
      .scriptOf("agent:agentB")
      .thenReturn(callTool(AskTool, { question: "Wait!" }), replyWith("done B"));

    const app = await createApp(ParallelFlow, offline(book));
    const input = new WorkflowStartText();
    input.text = "go";
    const run = await app.execute(Start, { text: "go" });

    expect(run.status).toBe("paused");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const pause = run.pause!;
    expect(pause.agent).toBe("agentB");

    const resumed = await app.resume(run.thread, "ok");
    expect(resumed.status).toBe("answered");
  });

  it("should swallow errors from optional agents and merge successful branches", async () => {
    const book = new ScriptBook();
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    book;
    book.scriptOf("router:router").thenReturn(replyWith("parallel(AgentA, optional(AgentB))"));
    book.scriptOf("agent:agentA").thenReturn(replyWith("done A"));
    book.scriptOf("agent:agentB").thenReturn(new Error("Network failed") as any);

    const app = await createApp(ParallelFlow, offline(book));
    const run = await app.execute(Start, { text: "go" });

    // The run should finish successfully, as AgentB error was swallowed
    expect(run.status).toBe("answered");
  });
});

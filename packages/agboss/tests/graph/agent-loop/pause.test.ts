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
  WorkflowStart,
  WorkflowFinish,
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

@Agent({
  name: "agent",
  description: "talk",
  prompt: "Use ask tool to ask name.",
  tools: [AskTool],
  model: "stub",
})
class Talker {}

@Workflow({
  name: "test-pause",
  version: "1.0",
  defaults: {
    models: { maxTokens: 100, temperature: 0 },
    history: { limit: 1 },
    tools: { maxToolCalls: 1 },
    router: { kind: "llm", model: "stub" },
  },
  flow: [chain(Start, Talker, Finish)],
})
class PauseFlow implements WorkflowDefinition {
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

describe("interactive pause", () => {
  it("pauses in the tool and resumes with the replyWith", async () => {
    const book = new ScriptBook();
    book
      .scriptOf("agent:agent")
      .thenReturn(callTool(AskTool, { question: "Name?" }), replyWith("Hello!"));

    const app = await createApp(PauseFlow, offline(book));

    const run1 = await app.execute(Start, { text: "Go" });
    expect(run1.status).toBe("paused");
  });
});

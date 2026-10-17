import { describe, expect, it } from "vitest";
import { createApp, type AppOptions } from "../../../src/app/create-app.js";
import { Agent, Workflow, Tool } from "../../../src/components/decorators.js";
import { ScriptBook } from "../../../src/testing/script-book.js";
import { createScriptedGateway } from "../../../src/testing/scripted-gateway.js";
import { createMemoryLedger } from "../../../src/finops/ledger.js";
import { createSqliteTernStore } from "../../../src/terns/index.js";
import { callTool, replyWith } from "../../../src/testing/index.js";
import type { ToolContext } from "../../../src/tools/index.js";
import {
  WorkflowPauseQuestionDto,
  WorkflowPauseAnswerDto,
} from "../../../src/dto/standard/framework.js";
import {
  WorkflowSettings,
  type WorkflowDefinition,
  WorkflowStart,
  WorkflowFinish,
} from "../../../src/index.js";
import { WorkflowStartTextDto, WorkflowFinishTextDto } from "../../../src/dto/index.js";
import { createMemoryPausedRunRepository } from "../../../src/app/paused-runs.js";
import { start } from "../../helpers/flow.js";
import { ExecutionStatus } from "../../../src/app/types.js";

@WorkflowStart({ name: "start-workflow-start", description: "Start", input: WorkflowStartTextDto })
class Start {}

@WorkflowFinish({
  name: "finish-workflow-finish",
  description: "Finish",
  output: WorkflowFinishTextDto,
})
class Finish {}

@Tool({
  name: "ask",
  description: "ask user",
  input: WorkflowPauseQuestionDto,
  output: WorkflowPauseAnswerDto,
})
class AskTool {
  run(input: WorkflowPauseQuestionDto, ctx: ToolContext): Promise<WorkflowPauseAnswerDto> {
    const response = ctx.pause(input) as string;
    const ans = new WorkflowPauseAnswerDto();
    ans.replyWith = response;
    return Promise.resolve(ans);
  }
}

@Agent({
  name: "agent-agent",
  description: "talk",
  prompt: "Use ask tool to ask name.",
  tools: [AskTool],
  model: "stub",
})
class Talker {}

@Workflow({
  name: "test-pause-workflow",
  version: "1.0",
  defaults: {
    models: { maxTokens: 100, temperature: 0 },
    history: { limit: 1 },
    tools: { maxToolCalls: 1 },
    router: { model: "stub" },
  },
  flow: [start(Start).returns(WorkflowStartTextDto).toAgent(Talker).toFinish(Finish)],
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

    const run1 = await execute(app, Start, { text: "Go" });
    expect(run1.status).toBe(ExecutionStatus.Paused);
  });
});

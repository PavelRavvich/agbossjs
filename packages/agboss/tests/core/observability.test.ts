import { describe, expect, it } from "vitest";
import {
  Agent,
  Injectable,
  Tool,
  Workflow,
  type AppState,
  type ModelStartEvent,
  type ModelEndEvent,
  type AgentStartEvent,
  type RouterStartEvent,
  type RagStartEvent,
  type AgentEndEvent,
  type RouterEndEvent,
  type RagEndEvent,
  type OnAgentEnd,
  type OnAgentStart,
  type OnError,
  type OnModelEnd,
  type OnModelStart,
  type OnRagStart,
  type OnRagEnd,
  type OnRouterEnd,
  type OnRouterStart,
  type OnToolEnd,
  type OnToolStart,
  type OnWorkflowEnd,
  type OnWorkflowStart,
  type ToolEndEvent,
  type ToolStartEvent,
  Router,
  WorkflowStart,
  from,
} from "../../src/index.js";
import { WorkflowFinish } from "../../src/graph/workflow-finish.decorator.js";
import { Rag } from "../../src/components/decorators.js";
import { RagRetrieval } from "../../src/rag/types.js";
import { WorkflowStartText, WorkflowFinishText, Text } from "../../src/dto/index.js";
import { createSqliteTernStore } from "../../src/terns/index.js";
import { buildApp } from "../../src/app/create-app.js";
import { workflowOf } from "../../src/components/assemble.js";
import { createScriptedGateway } from "../../src/testing/scripted-gateway.js";
import { ScriptBook } from "../../src/testing/script-book.js";
import { replyWith, callTool, routeTo } from "../../src/testing/index.js";
import { testConfig } from "../helpers.js";
import { TestSettings } from "../fixtures/test-flow/star.js";

class ToolInput {
  @Text() text!: string;
}

const hookEvents: string[] = [];
let capturedState: AppState | null = null;

@Injectable()
class GlobalObserver
  implements
    OnWorkflowStart,
    OnWorkflowEnd,
    OnAgentStart,
    OnAgentEnd,
    OnRouterStart,
    OnRouterEnd,
    OnToolStart,
    OnToolEnd,
    OnModelStart,
    OnModelEnd,
    OnRagStart,
    OnRagEnd,
    OnError
{
  async onWorkflowStart(state: AppState) {
    hookEvents.push("WorkflowStart");
    capturedState = state;
  }
  async onWorkflowEnd() {
    hookEvents.push("WorkflowEnd");
  }

  async onAgentStart(ctx: AgentStartEvent) {
    hookEvents.push(`AgentStart:${ctx.name}`);
  }
  async onAgentEnd(ctx: AgentEndEvent) {
    hookEvents.push(`AgentEnd:${ctx.name}`);
  }

  async onRouterStart(ctx: RouterStartEvent) {
    hookEvents.push(`RouterStart:${ctx.name}`);
  }
  async onRouterEnd(ctx: RouterEndEvent) {
    hookEvents.push(`RouterEnd:${ctx.name}`);
  }

  async onToolStart(ctx: ToolStartEvent) {
    hookEvents.push(`ToolStart:${ctx.toolName}`);
  }
  async onToolEnd(ctx: ToolEndEvent) {
    hookEvents.push(`ToolEnd:${ctx.toolName}`);
  }

  async onModelStart(req: ModelStartEvent) {
    hookEvents.push(`ModelStart:${req.callerName}`);
  }
  async onModelEnd(res: ModelEndEvent) {
    hookEvents.push(`ModelEnd:${res.callerName}`);
  }

  async onRagStart(ctx: RagStartEvent) {
    hookEvents.push(`RagStart:${ctx.name}`);
  }
  async onRagEnd(ctx: RagEndEvent) {
    hookEvents.push(`RagEnd:${ctx.name}`);
  }
  async onError(err: Error, state: AppState) {
    hookEvents.push("Error");
  }
}

@Tool({
  name: "ObsTool",
  description: "Does things",
  input: ToolInput,
  output: ToolInput,
})
class ObsTool {
  async run(input: ToolInput) {
    return { text: "done" };
  }
}

@WorkflowStart({ name: "Start", description: "Start", input: WorkflowStartText })
class ObsStart {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "ObsFinish", description: "Finish", output: WorkflowFinishText })
class ObsFinish {}

@Rag({ name: "ObsRag", description: "test rag", topK: 5 })
class ObsRag {
  async retrieve(): Promise<RagRetrieval> {
    return { results: [] };
  }
}

@Agent({
  name: "ObsAgent",
  description: "test agent",
  model: "test",

  tools: [ObsTool],
  rag: [{ use: ObsRag, mode: "context" }],
})
class ObsAgent {}

@Router({
  description: "Router",
  model: "stub",
  name: "ObsRouter",
  prompt: "Decide.",
  maxVisits: 10,
  routes: [
    { prompt: "go", target: ObsAgent },
    { prompt: "stop", target: ObsFinish },
  ],
})
class ObsRouter {}

@Workflow({
  name: "obs-test",
  version: "1.0.0",
  defaults: testConfig.defaults,
  observers: [GlobalObserver],
  flow: [from(ObsStart).next(ObsRouter), from(ObsRouter).routes(), from(ObsAgent).next(ObsRouter)],
})
class ObsWorkflow extends TestSettings {}

describe("Global Observability Hooks", () => {
  it("fires hooks in correct order and provides AppState", async () => {
    hookEvents.length = 0; // reset
    capturedState = null;

    const book = new ScriptBook();
    book.scriptOf("router:ObsRouter").thenReturn(routeTo(ObsAgent), routeTo(ObsFinish));
    book
      .scriptOf("agent:ObsAgent")
      .thenReturn(callTool(ObsTool, { text: "hello" }), replyWith("Hello user!"));

    const { app } = await buildApp(await workflowOf(ObsWorkflow), {
      gateway: createScriptedGateway(book),
      stores: { terns: createSqliteTernStore(":memory:") },
    });

    book.scriptOf("router:ObsRouter").thenReturn(routeTo(ObsAgent), routeTo(ObsFinish));
    book
      .scriptOf("agent:ObsAgent")
      .thenReturn(callTool(ObsTool, { text: "hello" }), replyWith("Hello user!"));
    const result = await app.execute(ObsStart, { text: "Hi" });

    // Ensure all hook types fired
    expect(hookEvents).toContain("WorkflowStart");
    expect(hookEvents).toContain("WorkflowEnd");
    expect(hookEvents).toContain("RouterStart:ObsRouter");
    expect(hookEvents).toContain("RouterEnd:ObsRouter");
    expect(hookEvents).toContain("AgentStart:ObsAgent");
    expect(hookEvents).toContain("AgentEnd:ObsAgent");
    expect(hookEvents).toContain("ToolStart:ObsTool");
    expect(hookEvents).toContain("ToolEnd:ObsTool");
    expect(hookEvents).toContain("ModelStart:ObsAgent");
    expect(hookEvents).toContain("ModelEnd:ObsAgent");
    expect(hookEvents).toContain("RagStart:ObsRag");
    expect(hookEvents).toContain("RagEnd:ObsRag");

    expect(capturedState).not.toBeNull();
    // #238: the run's own id, the one its result carries
    expect((capturedState as AppState | null)?.runId).toBe(result.runId);

    await app.close();
  });
});

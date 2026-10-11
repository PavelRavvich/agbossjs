import { describe, expect, it } from "vitest";
import {
  Agent,
  Guardrail,
  Injectable,
  PiiPolicy,
  Tool,
  Workflow,
  WorkflowAction,
  type AppState,
  type OnActionEnd,
  type OnActionStart,
  type OnAgentEnd,
  type OnAgentStart,
  type OnChannelEnd,
  type OnChannelStart,
  type OnGuardrailEnd,
  type OnGuardrailStart,
  type OnPiiPolicyEnd,
  type OnPiiPolicyStart,
  type OnToolEnd,
  type OnToolStart,
  type OnWorkflowEnd,
  type OnWorkflowStart,
  type ActionEndEvent,
  type ActionStartEvent,
  type AgentEndEvent,
  type AgentStartEvent,
  type ChannelEndEvent,
  type ChannelStartEvent,
  type GuardrailEndEvent,
  type GuardrailStartEvent,
  type PiiPolicyEndEvent,
  type PiiPolicyStartEvent,
  type ToolEndEvent,
  type ToolStartEvent,
  from,
  WorkflowStart,
  WorkflowFinish,
} from "../../src/index.js";
import { ActionRuntime } from "../../src/components/decorators.js";
import { WorkflowStartText, WorkflowFinishText, Text } from "../../src/dto/index.js";
import { createSqliteTernStore } from "../../src/terns/index.js";
import { buildApp } from "../../src/app/create-app.js";
import { workflowOf } from "../../src/components/assemble.js";
import { createScriptedGateway } from "../../src/testing/scripted-gateway.js";
import { ScriptBook } from "../../src/testing/script-book.js";
import { replyWith, callTool } from "../../src/testing/index.js";
import { testConfig } from "../helpers.js";
import { TestSettings } from "../fixtures/test-flow/star.js";

class ToolInput {
  @Text() text!: string;
}

const hookEvents: string[] = [];

@Injectable()
class TailsObserver
  implements
    OnWorkflowStart,
    OnWorkflowEnd,
    OnAgentStart,
    OnAgentEnd,
    OnActionStart,
    OnActionEnd,
    OnToolStart,
    OnToolEnd,
    OnGuardrailStart,
    OnGuardrailEnd,
    OnPiiPolicyStart,
    OnPiiPolicyEnd,
    OnChannelStart,
    OnChannelEnd
{
  async onWorkflowStart() {
    hookEvents.push("WorkflowStart");
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

  async onToolStart(ctx: ToolStartEvent) {
    hookEvents.push(`ToolStart:${ctx.toolName}`);
  }
  async onToolEnd(ctx: ToolEndEvent) {
    hookEvents.push(`ToolEnd:${ctx.toolName}`);
  }

  async onActionStart(ctx: ActionStartEvent) {
    hookEvents.push(`ActionStart:${ctx.name}`);
  }
  async onActionEnd(ctx: ActionEndEvent) {
    hookEvents.push(`ActionEnd:${ctx.name}`);
  }

  async onGuardrailStart(ctx: GuardrailStartEvent) {
    hookEvents.push(`GuardrailStart:${ctx.name}`);
  }
  async onGuardrailEnd(ctx: GuardrailEndEvent) {
    hookEvents.push(`GuardrailEnd:${ctx.name}`);
  }

  async onPiiPolicyStart(ctx: PiiPolicyStartEvent) {
    hookEvents.push(`PiiStart:${ctx.name}`);
  }
  async onPiiPolicyEnd(ctx: PiiPolicyEndEvent) {
    hookEvents.push(`PiiEnd:${ctx.name}`);
  }

  async onChannelStart(ctx: ChannelStartEvent) {
    hookEvents.push(`ChannelStart:${ctx.name}`);
  }
  async onChannelEnd(ctx: ChannelEndEvent) {
    hookEvents.push(`ChannelEnd:${ctx.name}`);
  }
}

@PiiPolicy({ name: "MaskingPolicy" })
class MaskingPolicy {
  async maskJson(obj: any) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return obj;
  }
  async mask(text: string) {
    return text;
  }
  async unmask(text: string) {
    return text;
  }
}

@Guardrail({ name: "SafeGuard" })
class SafeGuard {
  async beforeToolCall() {
    /* noop */
  }
  async afterToolCall() {
    /* noop */
  }
}

@Tool({
  name: "SafeTool",
  description: "Does things",
  input: ToolInput,
  output: ToolInput,
})
class SafeTool {
  async run() {
    return { text: "done" };
  }
}

@Agent({
  name: "SafeAgent",
  description: "test agent",
  model: "test",
  tools: [SafeTool],

  guardrails: [SafeGuard],
})
class SafeAgent {}

@WorkflowAction({ name: "FormatAction" })
class FormatAction {
  async execute() {
    return { payload: { format: true } };
  }
}

@WorkflowStart({ name: "Start", input: WorkflowStartText, description: "" })
class StartNode {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "Finish", output: WorkflowFinishText, description: "" })
class FinishNode {}

@Workflow({
  name: "tails-test",
  version: "1.0.0",
  defaults: testConfig.defaults,
  observers: [TailsObserver],
  flow: [
    from(StartNode).next(SafeAgent),
    from(SafeAgent).next(FormatAction),
    from(FormatAction).next(FinishNode),
  ],
})
class TailsWorkflow extends TestSettings {}

describe("Observability Tails Hooks", () => {
  it("fires tails hooks in precise order", async () => {
    hookEvents.length = 0;

    const book = new ScriptBook();
    book
      .scriptOf("agent:SafeAgent")
      .thenReturn(callTool(SafeTool, { text: "hello" }), replyWith("Hello user!"));

    const { app } = await buildApp(await workflowOf(TailsWorkflow), {
      gateway: createScriptedGateway(book),
      stores: { terns: createSqliteTernStore(":memory:") },
    });

    await app.execute(StartNode, { text: "hi" });

    // Assert the exact flow
    // Workflow -> Agent -> Pii -> Guardrail -> Tool -> Guardrail -> Pii -> Agent -> Action -> WorkflowEnd

    // Check Action
    expect(hookEvents).toContain("ActionStart:FormatAction");
    expect(hookEvents).toContain("ActionEnd:FormatAction");

    // Order assertions
    const agentStart = hookEvents.indexOf("AgentStart:SafeAgent");
    const piiStart = hookEvents.indexOf("PiiStart:MaskingPolicy");
    const guardrailStart = hookEvents.indexOf("GuardrailStart:SafeGuard");
    const toolStart = hookEvents.indexOf("ToolStart:SafeTool");
    const toolEnd = hookEvents.indexOf("ToolEnd:SafeTool");
    const guardrailEnd = hookEvents.indexOf("GuardrailEnd:SafeGuard");

    const agentEnd = hookEvents.indexOf("AgentEnd:SafeAgent");
    expect(agentStart).toBeLessThan(guardrailStart);

    expect(guardrailStart).toBeLessThan(toolStart);
    expect(toolStart).toBeLessThan(toolEnd);
    const guardrailEnd2 = hookEvents.lastIndexOf("GuardrailEnd:SafeGuard");
    expect(toolEnd).toBeLessThan(guardrailEnd2);
    expect(guardrailEnd2).toBeLessThan(agentEnd);

    await app.close();
  });
});

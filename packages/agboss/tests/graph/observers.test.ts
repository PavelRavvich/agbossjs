import { describe, expect } from "vitest";
import {
  Workflow,
  Agent,
  OnWorkflowStart,
  AppState,
  OnAgentStart,
  type AgentStartEvent,
  Injectable,
  OnAgentEnd,
  type AgentEndEvent,
  from,
  node,
  WorkflowStart,
  WorkflowFinish,
  WorkflowSettings,
} from "../../src/index.js";
import { testWith, replyWith } from "../../src/testing/index.js";

const logs: string[] = [];

@Injectable()
class MyMetricsObserver implements OnWorkflowStart, OnAgentStart, OnAgentEnd {
  onWorkflowStart(state: AppState) {
    logs.push(`start-wf`);
  }
  onAgentStart(ctx: AgentStartEvent) {
    logs.push(`start-agent-${ctx.name}`);
  }
  onAgentEnd(ctx: AgentEndEvent) {
    logs.push(`end-agent-${ctx.name}`);
  }
}

@Agent({ name: "worker", model: "stub", description: "worker" })
class WorkerAgent {}

import { WorkflowStartText } from "../../src/dto/index.js";

@WorkflowStart({ name: "start", description: "Start", input: WorkflowStartText })
class Start {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "finish", description: "Finish", output: WorkflowStartText })
class Finish {}

import { usd } from "../../src/units/index.js";

@Workflow({
  name: "obs-wf",
  version: "1",
  defaults: {
    models: { temperature: 0, thinking: "default", cache: true },
    router: { kind: "jev", model: "typesafe/jev-1.13" },
    tools: { maxToolCalls: 1 },
    history: { limit: 1 },
  },
  flow: [from(Start).next(WorkerAgent), from(WorkerAgent).next(Finish)],
  observers: [MyMetricsObserver],
})
class ObsWf {
  settings() {
    return WorkflowSettings.builder()
      .limits({
        perDay: { cost: usd(100) },
        perRun: { steps: 10, cost: usd(1) },
      })
      .build();
  }
}

const test = testWith(ObsWf);

describe("Observers", () => {
  test("triggers observer hooks", async ({ app, mockLlm }) => {
    mockLlm(WorkerAgent).thenReturn(replyWith("done"));
    logs.length = 0; // reset
    await app.execute(Start, { text: "hello" });
    expect(logs).toEqual(["start-wf", "start-agent-worker", "end-agent-worker"]);
  });
});

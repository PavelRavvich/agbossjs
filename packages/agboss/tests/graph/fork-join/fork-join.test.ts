import { describe, expect, it } from "vitest";
import { Workflow, Agent, WorkflowStart, WorkflowFinish, from } from "../../../src/index.js";
import { workflowOf } from "../../../src/components/assemble.js";
import { recordNode } from "../../../src/graph/node-kind.js";
import { WorkflowStartText, WorkflowFinishText } from "../../../src/dto/index.js";
import type { JoinOutput, JoinHandler } from "../../../src/graph/fork-join.js";
import { assembleFlowGraph } from "../../../src/graph/build.js";
import { MemorySaver } from "@langchain/langgraph";
import type { WorkflowDefinition } from "../../../src/graph/settings.js";
import { WorkflowSettings } from "../../../src/graph/settings.js";

@WorkflowStart({ name: "startNode", description: "Start", input: WorkflowStartText })
export class StartNode {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "finishNode", description: "Finish", output: WorkflowFinishText })
export class FinishNode {}

@Agent({ name: "branchA", model: "stub", description: "a", prompt: "" })
export class BranchAAgent {}

@Agent({ name: "branchB", model: "stub", description: "b", prompt: "" })
export class BranchBAgent {}

@Agent({ name: "joinNode", model: "stub", description: "j", prompt: "" })
export class JoinNodeAgent implements JoinHandler<
  Record<string, import("../../../src/graph/fork-join.js").ForkOutput>
> {
  onJoin(
    outputs: Record<string, import("../../../src/graph/fork-join.js").ForkOutput>,
  ): JoinOutput | Promise<JoinOutput> {
    return {
      contributions: [
        {
          content: `Joined: ${String(outputs.branchA?.data)} and ${String(outputs.branchB?.data)}`,
        },
      ],
      payload: { customJoin: true },
    };
  }
}

@Workflow({
  name: "fork-join-test",
  version: "1.0",
  defaults: {
    models: { maxTokens: 100, temperature: 0 },
    history: { limit: 1 },
    tools: { maxToolCalls: 1 },
    router: { kind: "llm", model: "stub" },
  },
  flow: [
    from(StartNode).nextParallel(BranchAAgent, BranchBAgent),
    from(BranchAAgent, BranchBAgent).join(JoinNodeAgent),
    from(JoinNodeAgent).next(FinishNode),
  ],
})
export class ForkJoinWorkflow implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder().build();
  }
}

describe("fork-join", () => {
  recordNode(StartNode, { kind: "workflow-start", name: "startNode" });
  recordNode(FinishNode, { kind: "workflow-finish", name: "finishNode" });
  it("compiles and runs correctly", async () => {
    const assembled = await workflowOf(ForkJoinWorkflow);
    expect(assembled.flow).toBeDefined();

    const checkpointer = new MemorySaver();
    const runtime = {
      runnerFor: (node: { name?: string }) => async () => {
        const name = node.name;
        await Promise.resolve();
        if (name === "branchA")
          return { contributions: [{ agent: "branchA", content: "Result A" }] };
        if (name === "branchB")
          return { contributions: [{ agent: "branchB", content: "Result B" }] };
        if (name === "joinNode")
          return { contributions: [{ agent: "joinNode", content: "Final Answer" }] };
        return {};
      },
      routerFor: () => ({}) as unknown as import("../../../src/routers/index.js").RouterEngine,
      routerMemory: { limit: 10, summaries: 0, turns: 10 },
      limits: { perRun: { steps: 50 } },
      spentToday: () => Promise.resolve(0),
      checkpointer,
    };

    const { graph } = await assembleFlowGraph(assembled.flow, runtime);

    const result = await graph.invoke(
      {
        start: "startNode",
        task: "start",
        history: [],
        contributions: [],
        usage: [],
        payload: {},
        forks: {},
      },
      { configurable: { thread_id: "1" } },
    );

    expect(result.contributions.length).toBeGreaterThan(0);
    const joinedContrib = result.contributions.find((c) =>
      (typeof c.content === "string" ? c.content : "").startsWith("Joined:"),
    );
    if (!joinedContrib) throw new Error("Missing: " + JSON.stringify(result.contributions));
    expect(joinedContrib.content).toBe("Joined: Result A and Result B");
    expect(joinedContrib.agent).toBe("joinNode");
    expect(result.payload.customJoin).toBe(true);
  });
});

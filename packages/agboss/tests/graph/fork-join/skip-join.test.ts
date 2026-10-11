import { describe, expect, it } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import {
  Agent,
  Workflow,
  from,
  Router,
  WorkflowFinish,
  WorkflowStart,
  WorkflowSettings,
  type WorkflowDefinition,
} from "../../../src/index.js";
import { workflowOf } from "../../../src/components/assemble.js";
import { assembleFlowGraph } from "../../../src/graph/build.js";
import { WorkflowFinishText, WorkflowStartText } from "../../../src/dto/index.js";
import { Return } from "../../../src/graph/flow.js";
import type { RouterEngine as RoutingStrategy } from "../../../src/routers/index.js";

@WorkflowStart({ name: "skipStart", description: "Start", input: WorkflowStartText })
export class SkipStart {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "skipFinish", description: "Finish", output: WorkflowFinishText })
export class SkipFinish {}

@Agent({ name: "skipA", model: "stub", description: "a", prompt: "" })
export class SkipA {}

@Agent({ name: "skipB", model: "stub", description: "b", prompt: "" })
export class SkipB {}

@Agent({ name: "skipAggregator", model: "stub", description: "aggregates", prompt: "" })
export class SkipAggregator {}

@Router({
  name: "skipPicker",
  description: "Picks a branch",
  prompt: "Which branch?",
  model: "stub",
  routes: [
    { prompt: "branch A", target: SkipA },
    { prompt: "branch B", target: SkipB },
    { prompt: "skip", target: Return },
  ],
})
export class SkipPicker {}

@Workflow({
  name: "skip-join-test",
  version: "1.0",
  defaults: {
    models: { maxTokens: 100, temperature: 0 },
    history: { limit: 1 },
    tools: { maxToolCalls: 1 },
    router: { kind: "llm", model: "stub" },
  },
  flow: [
    from(SkipStart).next(SkipPicker),
    from(SkipPicker).routes(),
    from(SkipA, SkipB).join(SkipAggregator),
    from(SkipAggregator).next(SkipFinish),
  ],
})
export class SkipJoinWorkflow implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder().build();
  }
}

const picking = (next: string): RoutingStrategy => ({
  name: "picker",
  route: () => Promise.resolve({ kind: "decided", decision: { next, reason: "test" } }),
});

it("does not leave the join waiting when explicitly skipping", async () => {
  const { visited, state } = await run("Return");
  expect(visited).toContain("skipAggregator");
});

async function run(chosen: string) {
  const assembled = await workflowOf(SkipJoinWorkflow);
  const visited: string[] = [];
  const runtime = {
    runnerFor: (node: { name?: string }) => () => {
      visited.push(node.name ?? "");
      return Promise.resolve(
        node.name?.startsWith("skip") === true && node.name !== "skipStart"
          ? { contributions: [{ agent: node.name, content: `from ${node.name}` }] }
          : {},
      );
    },
    routerFor: () => picking(chosen),
    routerMemory: { limit: 10, summaries: 0, turns: 10 },
    limits: { perRun: { steps: 50 } },
    spentToday: () => Promise.resolve(0),
    checkpointer: new MemorySaver(),
  };
  const { graph } = await assembleFlowGraph(assembled.flow, runtime);
  const state = await graph.invoke(
    {
      start: "skipStart",
      task: "go",
      history: [],
      contributions: [],
      usage: [],
      payload: {},
      forks: {},
    },
    { configurable: { thread_id: `t-${chosen}` } },
  );
  return { state, visited };
}

describe("a router that skips a join source", () => {
  it("does not leave the join waiting: the aggregator runs after the chosen branch", async () => {
    const { visited, state } = await run("skipA");

    expect(visited).toContain("skipA");
    expect(visited).not.toContain("skipB");
    expect(visited).toContain("skipAggregator");
    expect(state.forks.skipB).toMatchObject({ status: "skipped" });
    expect(state.forks.skipA).toMatchObject({ status: "completed" });
  });

  it("works symmetrically when the other branch is chosen", async () => {
    const { visited, state } = await run("skipB");

    expect(visited).toContain("skipB");
    expect(visited).not.toContain("skipA");
    expect(visited).toContain("skipAggregator");
    expect(state.forks.skipA).toMatchObject({ status: "skipped" });
  });
});

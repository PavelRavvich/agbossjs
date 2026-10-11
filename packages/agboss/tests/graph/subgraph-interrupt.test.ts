import {
  Annotation,
  Command,
  END,
  interrupt,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { assembleFlowGraph } from "../../src/graph/build.js";
import { from } from "../../src/graph/flow.js";
import { subgraphNode } from "../../src/graph/subgraph-node.js";
import { testRunner, testRuntime } from "./fixtures/nodes.js";
import { A, Done, Start } from "./fixtures/rule-nodes.js";

/** The agent's own loop as a subgraph: it asks a human, then answers. */
const AskState = Annotation.Root({
  question: Annotation<string>(),
  reply: Annotation<string>(),
});

const askHuman = new StateGraph(AskState)
  .addNode("ask", (state) => ({ reply: String(interrupt(state.question)) }))
  .addEdge(START, "ask")
  .addEdge("ask", END)
  .compile();

const runtime = testRuntime(
  {},
  {
    checkpointer: new MemorySaver(),
    runnerFor: (node) =>
      node.kind === "agent"
        ? subgraphNode(askHuman, {
            input: (state) => ({ question: `approve "${state.task}"?`, reply: "" }),
            output: (result) => ({ contributions: [{ agent: node.name, content: result.reply }] }),
          })
        : testRunner(node),
  },
);

describe("AC1: a compiled subgraph as a flow node", () => {
  it("an interrupt() inside the subgraph pauses the whole run; resume continues it", async () => {
    const { graph } = await assembleFlowGraph([from(Start).next(A), from(A).next(Done)], runtime);
    const config = { configurable: { thread_id: "subgraph-interrupt" } };

    await graph.invoke({ task: "deploy" }, config);
    const paused = await graph.getState(config);
    const resumed = await graph.invoke(new Command({ resume: "yes" }), config);

    expect(paused.next).toEqual(["agent.a"]);
    expect(paused.tasks[0]?.interrupts[0]?.value).toBe('approve "deploy"?');
    expect(resumed.replyWith).toBe("yes");
    expect(resumed.path).toEqual(["workflow-start.start", "a", "done"]);
    expect(resumed.steps).toBe(1);
  });
});

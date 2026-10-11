import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { describe, expect, it, vi } from "vitest";
import { costCategoryOf, recordReportedCost } from "../../src/finops/usage.js";
import { gatherKnowledge } from "../../src/graph/nodes/knowledge.js";
import { runAgent, type RunDeps } from "../../src/index.js";
import { createModelRegistry, type ModelFactory } from "../../src/llm/registry.js";
import { CITE_INSTRUCTION } from "../../src/prompts/rag.js";
import type { KnowledgeSource } from "../../src/rag/index.js";
import { ScriptedChatModel } from "../fakes/scripted-model.js";
import { routeTo, fakeDeps, testConfig, type TestAgent, fakeGateway } from "../helpers.js";

const handbook = (retrieve: KnowledgeSource["retrieve"]): KnowledgeSource => ({
  name: "handbook",
  topK: 2,
  retrieve,
});
const found: KnowledgeSource["retrieve"] = () =>
  Promise.resolve({
    results: [{ source: "oncall.md", text: "On-call starts after the third month." }],
    costUsd: 0.0002,
  });

function setup(source: KnowledgeSource) {
  const alpha = new ScriptedChatModel(["After the third month [oncall.md]."]);
  const factory = vi.fn<ModelFactory>((s) =>
    s.model === "test/alpha" ? alpha : new FakeListChatModel({ responses: ["x"] }),
  );
  const base = fakeDeps({ "test/router": [routeTo("alpha"), routeTo("replyWith", "done")] });
  const deps: RunDeps<TestAgent> = {
    ...base,
    registry: createModelRegistry(testConfig, fakeGateway(factory)),
    knowledge: (agent) => (agent === "alpha" ? [source] : []),
  };
  return { deps, alpha };
}

const agentInput = (model: ScriptedChatModel): string =>
  model.sent[0]?.findLast((m) => m.type === "human")?.text ?? "";

describe("knowledge bases — context mode", () => {
  it("AC2, AC3, #141 AC4, #148 AC3: { results } with sources come before the task, with the cite instruction; cost in retrieval", async () => {
    const retrieve = vi.fn(found);
    const { deps, alpha } = setup(handbook(retrieve));

    const result = await runAgent({ task: "When does on-call start?" }, deps);

    expect(retrieve).toHaveBeenCalledWith(
      "When does on-call start?",
      expect.objectContaining({ topK: 2 }),
    );
    expect(agentInput(alpha)).toContain(
      "Knowledge (handbook):\n[oncall.md] On-call starts after the third month.",
    );
    expect(agentInput(alpha)).toContain(CITE_INSTRUCTION);
    expect(agentInput(alpha)).toContain("Answer from these search results when they are relevant");
    expect(agentInput(alpha)).not.toContain("passages");
    expect(result.cost.byCategory.retrieval).toBeCloseTo(0.0002);
    expect(result.replyWith).toContain("[oncall.md]");
  });

  it("AC2: a retrieval failure never fails the turn (fail-open)", async () => {
    const { deps, alpha } = setup(handbook(() => Promise.reject(new Error("index down"))));

    const result = await runAgent({ task: "When does on-call start?" }, deps);

    expect(result.status).toBe("answered");
    expect(agentInput(alpha)).not.toContain("Knowledge (");
  });

  it("AC3: each retrieval is a named span in the trace", async () => {
    const names: string[] = [];
    class Recorder extends BaseCallbackHandler {
      name = "recorder";
      override handleChainStart(
        ...args: Parameters<NonNullable<BaseCallbackHandler["handleChainStart"]>>
      ): void {
        names.push(args[7] ?? "");
      }
    }

    await gatherKnowledge([handbook(found)], "q", { callbacks: [new Recorder()] });

    expect(names).toContain("rag:handbook");
  });

  it("AC3: tool-mode costs are billed to rag:<name> — category retrieval", () => {
    const record = recordReportedCost(
      { name: "search_handbook", costCaller: "rag:handbook" },
      0.001,
    );

    expect(record.caller).toBe("rag:handbook");
    expect(costCategoryOf(record.caller)).toBe("retrieval");
    expect(costCategoryOf(recordReportedCost({ name: "exchange_rate" }, 0.001).caller)).toBe(
      "tools",
    );
  });
});

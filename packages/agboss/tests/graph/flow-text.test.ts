import { describe, expect, it } from "vitest";
import { MODEL_MAX, type AgentsConfigOf } from "../../src/config/types.js";
import { flowLines } from "../../src/graph/flow-text.js";
import { chatModelSettingsOf } from "../../src/graph/router-model.js";
import { codeReviewFlow } from "./fixtures/code-review.js";
import { from, Self } from "../../src/graph/flow.js";
import { A, Done, Gate, SomeTool, Start } from "./fixtures/rule-nodes.js";
import { testConfig } from "../helpers.js";

describe("AC1: describe lists the flow as transitions (text)", () => {
  it("#141 AC2: one line per declared step: to, choose, chain — nodes by name, starts and finishes marked", () => {
    expect(flowLines(codeReviewFlow)).toEqual([
      "chat (workflow start) → main",
      "main → explainer | coder",
      "explainer → replyWith (workflow finish)",
      "coder → reviewer → review-gate",
      "review-gate → coder | pull-request (workflow finish)",
    ]);
  });

  it("Self and classes that are not nodes are shown as people read them", () => {
    expect(
      flowLines([
        from(Start).next(A),
        from(A).next(Gate),
        from(Gate).routes(),
        from(A).next(SomeTool),
      ]),
    ).toEqual([
      "start (workflow start) → a",
      "a → gate",
      "gate → Self | done (workflow finish)",
      "a → SomeTool",
    ]);
  });
});

describe("a router on a chat model is priced like the agent using that model", () => {
  const config: AgentsConfigOf<"alpha" | "beta"> = {
    ...testConfig,
    defaults: {
      ...testConfig.defaults,
      models: { ...testConfig.defaults.models, maxTokens: MODEL_MAX },
    },
    compaction: {
      every: 2,
      keep: 3,
      model: { model: "test/compactor", price: { inputPerMTok: 9, outputPerMTok: 9 } },
    },
  };

  it("finds the price by model id (agents, then compaction)", () => {
    const settingsOf = chatModelSettingsOf(config);

    expect(settingsOf("test/alpha")).toEqual({
      model: "test/alpha",
      price: testConfig.agents.alpha.price,
    });
    expect(settingsOf("test/compactor").price?.inputPerMTok).toBe(9);
  });

  it("a model nobody prices is priced by its provider (#151)", () => {
    expect(chatModelSettingsOf(testConfig)("test/unknown")).toEqual({ model: "test/unknown" });
  });
});

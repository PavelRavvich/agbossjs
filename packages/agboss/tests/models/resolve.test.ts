import { describe, expect, it } from "vitest";
import {
  DECISION_MODELS,
  DecisionsModelProvider,
  ModelProvider,
  ModelProviderDirectory,
  ModelProviderError,
  ModelPurpose,
} from "../../src/models/index.js";
import { modelProviderOf } from "../../src/models/model-provider.decorator.js";
import { directoryOf } from "../../src/models/workflow-models.js";
import {
  LocalMirrorModelProvider,
  LocalModelProvider,
  TestOpenRouterProvider,
} from "./providers.fixture.js";

const chat = (model: string, override?: string) => ({
  key: "agents.scout",
  model,
  purpose: ModelPurpose.Chat,
  ...(override === undefined ? {} : { override }),
});

const providerOf = (directory: ModelProviderDirectory, query: ReturnType<typeof chat>) => {
  const resolution = directory.resolve(query);
  return resolution.kind === "resolved"
    ? resolution.provider.options.name
    : resolution.problem.code;
};

describe("AC6: which provider serves a model (serves patterns)", () => {
  const directory = ModelProviderDirectory.of([
    TestOpenRouterProvider,
    DecisionsModelProvider,
    LocalModelProvider,
  ]);

  it("AC6: exactly one provider serving the model for its purpose serves it", () => {
    expect(providerOf(directory, chat("moonshotai/kimi-k2.6"))).toBe("openrouter");
    // OpenRouter serves /.*/ but has no decisions; Jev has no chat models
    expect(
      providerOf(directory, { ...chat("typesafe/jev-1.13"), purpose: ModelPurpose.Decision }),
    ).toBe("decisions");
  });

  it("AC6: a component's override wins over serves", () => {
    const both = ModelProviderDirectory.of([LocalModelProvider, LocalMirrorModelProvider]);

    expect(providerOf(both, chat("local/llama", "local-mirror"))).toBe("local-mirror");
  });

  it("AC6: no provider → model.no-provider, with the key and the registered providers", () => {
    const onlyLocal = ModelProviderDirectory.of([LocalModelProvider]);

    expect(onlyLocal.resolve(chat("moonshotai/kimi-k2.6"))).toEqual({
      kind: "problem",
      problem: {
        code: "model.no-provider",
        key: "agents.scout",
        value: "moonshotai/kimi-k2.6",
        model: "moonshotai/kimi-k2.6",
        supported: "no registered provider serves it for chat (registered: local)",
      },
    });
  });

  it("AC6: several providers → model.ambiguous-provider, unless one is the default", () => {
    const both = ModelProviderDirectory.of([LocalModelProvider, LocalMirrorModelProvider]);
    const withDefault = ModelProviderDirectory.of(
      [LocalModelProvider, LocalMirrorModelProvider],
      LocalMirrorModelProvider,
    );

    expect(providerOf(both, chat("local/llama"))).toBe("model.ambiguous-provider");
    expect(providerOf(withDefault, chat("local/llama"))).toBe("local-mirror");
  });

  it("AC6: an override to a provider that does not serve the model, or does not exist, is model.no-provider", () => {
    expect(providerOf(directory, chat("moonshotai/kimi-k2.6", "local"))).toBe("model.no-provider");
    expect(providerOf(directory, chat("moonshotai/kimi-k2.6", "nobody"))).toBe("model.no-provider");
  });

  it("AC6: a workflow that registers none gets OpenRouter for chat and Jev for decisions", () => {
    const defaults = directoryOf(undefined);

    expect(providerOf(defaults, chat("test/alpha"))).toBe("openrouter");
    expect(
      providerOf(defaults, { ...chat("typesafe/jev-1.13"), purpose: ModelPurpose.Decision }),
    ).toBe("decisions");
    expect(providerOf(defaults, chat("typesafe/jev-1.13"))).toBe("model.no-provider");
    // #226: every decision model, not only Jev, is the Decisions API's — none is a chat model
    for (const model of DECISION_MODELS) {
      expect(providerOf(defaults, { ...chat(model), purpose: ModelPurpose.Decision })).toBe(
        "decisions",
      );
      expect(providerOf(defaults, chat(model))).toBe("model.no-provider");
    }
  });

  it("AC6: a provider needs a serves pattern; a plain class is not a provider", () => {
    expect(() => ModelProvider({ ...modelProviderOf(LocalModelProvider), serves: [] })).toThrow(
      ModelProviderError,
    );
    expect(() => modelProviderOf(Date)).toThrow(ModelProviderError);
    expect(() => modelProviderOf({})).toThrow("a value is not a @ModelProvider class");
  });
});

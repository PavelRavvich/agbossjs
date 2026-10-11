/**
 * Spike #113, item 5 — `requestFields` on an agent is typed by its `overrideModelProvider`'s fields.
 * `@ts-expect-error` lines are verified by `tsc` in `make check`.
 */
import { describe, expect, it } from "vitest";
import {
  Agent,
  ModelProvider,
  OpenAiCompatibleProvider,
  agentOptionsOf,
  providerFieldsOf,
  type ChatCompletionFields,
} from "./provider.js";

interface OpenRouterFields extends ChatCompletionFields {
  readonly provider?: { readonly ignore?: readonly string[]; readonly sort?: "price" | "latency" };
  readonly transforms?: readonly string[];
}

/** #112 as written: the provider's own fields in the decorator — a typo is NOT caught. */
@ModelProvider({
  name: "openrouter",
  requestFields: { provider: { ignore: ["x"] }, transfroms: [] },
})
class OpenRouterAsSpecified extends OpenAiCompatibleProvider<OpenRouterFields> {}

/** Correction: the provider's own fields as a typed class field — checked like any assignment. */
class OpenRouterProvider extends OpenAiCompatibleProvider<OpenRouterFields> {
  override readonly requestFields: OpenRouterFields = { provider: { ignore: ["Inceptron"] } };
}

class TypoInProvider extends OpenAiCompatibleProvider<OpenRouterFields> {
  // @ts-expect-error — `transfroms` is not an OpenRouter field
  override readonly requestFields: OpenRouterFields = { transfroms: [] };
}

@Agent({
  name: "coder",
  model: "moonshotai/kimi-k2.6",
  overrideModelProvider: OpenRouterProvider,
  requestFields: { top_p: 0.9, provider: { sort: "price" } },
})
class CoderAgent {}

@Agent({ name: "explainer", model: "m", requestFields: { seed: 7 } })
class ExplainerAgent {}

@Agent({
  name: "typo",
  model: "m",
  overrideModelProvider: OpenRouterProvider,
  // @ts-expect-error — `provder` is not an OpenRouter field
  requestFields: { provder: { sort: "price" } },
})
class TypoAgent {}

@Agent({
  name: "nested-typo",
  model: "m",
  overrideModelProvider: OpenRouterProvider,
  // @ts-expect-error — `sort` takes "price" | "latency"
  requestFields: { provider: { sort: "cheapest" } },
})
class NestedTypoAgent {}

@Agent({
  name: "default-provider",
  model: "m",
  // @ts-expect-error — the default provider (from settings()) allows contract fields only
  requestFields: { provider: { sort: "price" } },
})
class DefaultProviderAgent {}

describe("spike #113 — requestFields typed by the provider", () => {
  it("keeps the options for the runtime", () => {
    expect(agentOptionsOf(CoderAgent)?.overrideModelProvider).toBe(OpenRouterProvider);
    expect(agentOptionsOf(ExplainerAgent)?.requestFields).toEqual({ seed: 7 });
    expect(new OpenRouterProvider().requestFields).toEqual({ provider: { ignore: ["Inceptron"] } });
  });

  it("a typo in the decorator's provider fields reaches the runtime unchecked", () => {
    expect(providerFieldsOf(OpenRouterAsSpecified)).toHaveProperty("transfroms");
    expect([TypoAgent, NestedTypoAgent, DefaultProviderAgent, TypoInProvider]).toHaveLength(4);
  });
});

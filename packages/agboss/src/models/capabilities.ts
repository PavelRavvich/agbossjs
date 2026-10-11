import type { ReasoningEffort } from "./reasoning.js";
import type { CachedPart, CacheRetention } from "./prompt-caching.js";

/** What a model does with reasoning; absent from `ModelCapabilities` = the provider does not say. */
export interface ReasoningSupport {
  readonly supported: boolean;
  readonly efforts: readonly ReasoningEffort[];
  readonly budget: boolean;
  /** An effort and a budget in one request. */
  readonly effortWithBudget: boolean;
  /** False when reasoning is mandatory for the model. */
  readonly canTurnOff: boolean;
}

/** What a model does with prompt caching; absent = the provider does not say. */
export interface PromptCachingSupport {
  readonly supported: boolean;
  readonly retentions: readonly CacheRetention[];
  readonly cachedParts: readonly CachedPart[];
}

/**
 * What a provider says a model supports. A missing part is not declared and is not checked; a
 * declared part is checked strictly — no setting is ever replaced by a nearby one.
 */
export interface ModelCapabilities {
  readonly model: string;
  /** Request parameters the model takes (`temperature`, `max_tokens`, …). */
  readonly parameters?: readonly string[];
  readonly reasoning?: ReasoningSupport;
  readonly promptCaching?: PromptCachingSupport;
}

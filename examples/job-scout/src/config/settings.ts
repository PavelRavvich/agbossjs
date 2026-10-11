/**
 * Settings the job-scout workflow uses (its limits and model providers are in its `settings()`).
 * Costs come from OpenRouter's answers (`model-providers/openrouter.model-provider.ts`).
 */
export const KIMI = "moonshotai/kimi-k2.6";

export const DEFAULTS = {
  // no maxTokens: AGBoss's default ceiling (8192) applies; reasoning and caching: the provider's
  models: { temperature: 0 },
  router: { kind: "jev", model: "typesafe/jev-1.13" },
  tools: { maxToolCalls: 8 },
  history: { limit: 5 },
} as const;

export const GUARDS = {
  input: { prompt_injection: { threshold: 0.7, refusal: "I can't help with that request." } },
  output: {
    pii: { threshold: 0.7, refusal: "The answer contained personal data and was withheld." },
  },
};

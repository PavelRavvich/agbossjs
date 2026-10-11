import { describe, expect, it } from "vitest";
import {
  ModelFailure,
  OpenRouterProvider,
  RetryPolicy,
  type OpenRouterFields,
} from "../../src/models/index.js";
import { seconds } from "../../src/units/index.js";

describe("AC6: requestFields are typed per provider (compile time)", () => {
  it("AC6: a typo in a provider's request fields does not compile", () => {
    abstract class Typo extends OpenRouterProvider {
      // @ts-expect-error — `provder` is not an OpenRouter request field
      override readonly requestFields: OpenRouterFields = { provder: { ignore: ["Inceptron"] } };
    }
    abstract class WrongValue extends OpenRouterProvider {
      // @ts-expect-error — `sort` takes "price" | "throughput" | "latency"
      override readonly requestFields: OpenRouterFields = { provider: { sort: "cheapest" } };
    }

    expect([Typo.name, WrongValue.name]).toEqual(["Typo", "WrongValue"]);
  });

  it("AC6: retry policies have required fields", () => {
    // @ts-expect-error — an exponential policy needs maxDelay, jitter and retryOn
    const partial = () => RetryPolicy.exponential({ maxAttempts: 3, initialDelay: seconds(1) });
    const fixed = RetryPolicy.fixed({
      maxAttempts: 2,
      delay: seconds(1),
      retryOn: [ModelFailure.RateLimited],
    });

    expect(typeof partial).toBe("function");
    expect(fixed.backoff).toBe("fixed");
  });
});

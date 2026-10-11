import { describe, expect, it } from "vitest";
import { EnvironmentVariable, MissingEnvironmentVariableError } from "../../src/models/index.js";
import { settingValueIn } from "../../src/models/environment-variable.js";

describe("AC6: settings read from the environment", () => {
  it("AC6: reads the variable, falls back to its default, fails when neither", () => {
    const key = EnvironmentVariable.named("API_KEY", { secret: true });
    const url = EnvironmentVariable.named("BASE_URL", {
      secret: false,
      defaultValue: "http://x.test",
    });

    expect(key.requireIn({ API_KEY: "k" })).toBe("k");
    expect(key.valueIn({ API_KEY: "" })).toBeUndefined();
    expect(() => key.requireIn({})).toThrow(MissingEnvironmentVariableError);
    expect(url.valueIn({})).toBe("http://x.test");
    expect([key.isSecret, String(key)]).toEqual([true, "$API_KEY"]);
    expect(EnvironmentVariable.named("PLAIN").isSecret).toBe(false);
  });

  it("AC6: a setting is a literal or a variable", () => {
    expect(settingValueIn("http://literal.test", {})).toBe("http://literal.test");
    expect(settingValueIn(EnvironmentVariable.named("U"), { U: "http://env.test" })).toBe(
      "http://env.test",
    );
  });
});

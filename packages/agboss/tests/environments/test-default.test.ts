import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APP_DEFAULT_ENVIRONMENTS,
  environmentFor,
  TEST_DEFAULT_ENVIRONMENTS,
} from "../../src/environments/load.js";
import "../fixtures/environments/app/environments/environment.js";

const fixtures = fileURLToPath(new URL("../fixtures/environments/", import.meta.url));
/** A workflow file path: its `environments/` folder is the one next to it. */
const workflowIn = (dir: string): string => join(fixtures, dir, "app.workflow.ts");

describe("#182: which environment a test gets when it names none", () => {
  it("tests prefer test.environment.ts when the app has one", async () => {
    const env = await environmentFor(workflowIn("tested"), {}, {}, TEST_DEFAULT_ENVIRONMENTS);
    expect(env?.apiUrl).toBe("https://api.test.example.com");
  });

  it("tests fall back to dev.environment.ts when there is no test file", async () => {
    const env = await environmentFor(workflowIn("app"), {}, {}, TEST_DEFAULT_ENVIRONMENTS);
    expect(env?.apiUrl).toBe("https://api.dev.example.com");
  });

  it("apps (CLI, createApp) still default to dev even when a test file exists", async () => {
    const env = await environmentFor(workflowIn("tested"), {}, {}, APP_DEFAULT_ENVIRONMENTS);
    expect(env?.apiUrl).toBe("https://api.dev.example.com");
  });

  it("a named environment wins over the defaults", async () => {
    const env = await environmentFor(
      workflowIn("tested"),
      { env: "dev" },
      {},
      TEST_DEFAULT_ENVIRONMENTS,
    );
    expect(env?.apiUrl).toBe("https://api.dev.example.com");
  });
});

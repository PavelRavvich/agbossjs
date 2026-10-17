import { describe, expect, it } from "vitest";
import { checkWorkflowModels } from "../../src/cli/check-models.js";
import { workflowOf } from "agboss/testing";
import { COMMANDS } from "../../src/cli/usage.js";
import { Priced } from "../../../agboss/tests/models/fixtures/priced.workflow.js";
import { KIMI_ENTRY, providerStub } from "../../../agboss/tests/models/stub.js";

describe("AC6: agboss check --models", () => {
  it("AC6: settings that fit print each model's provider and ok, exit code 0 — no API key needed", async () => {
    const report = await checkWorkflowModels(
      await workflowOf(Priced),
      {},
      providerStub([], [KIMI_ENTRY, { id: "local/llama" }]).fetch,
    );

    expect(report.exitCode).toBe(0);
    expect(report.lines.at(-1)).toBe("ok: 3 model settings fit their models");
    expect(report.lines[0]).toContain("agents.summariser-agent  local/llama · provider local");
  });

  it("AC6: every problem at once, with key, value, model and what it supports — exit code 1", async () => {
    const report = await checkWorkflowModels(
      await workflowOf(Priced),
      {},
      providerStub([], []).fetch,
    );

    expect(report).toEqual({
      exitCode: 1,
      lines: [
        "ConfigurationError: 2 model setting(s) do not fit their models",
        "  model.unknown-model  agents.summariser-agent = local/llama — model local/llama: local does not list it",
        "  model.unknown-model  agents.writer-agent = moonshotai/kimi-k2.6 — model moonshotai/kimi-k2.6: openrouter does not list it",
      ],
    });
  });

  it("AC6: agboss help lists the check command", () => {
    expect(COMMANDS.check?.usage).toBe(
      "agboss check --workflow <path> [--models] [--profile <name>] [--env <name>] [--json]",
    );
  });
});

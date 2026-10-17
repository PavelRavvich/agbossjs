import { describe, expect, it } from "vitest";
import {
  WorkflowSettings,
  WorkflowSettingsError,
  type WorkflowDefinition,
} from "../../src/graph/settings.js";
import { minutes, seconds, UnitError, usd } from "../../src/units/index.js";

describe("AC1: workflow settings and units", () => {
  class TestWorkflow implements WorkflowDefinition {
    settings(): WorkflowSettings {
      return WorkflowSettings.builder()
        .limits({ perRun: { cost: usd(0.5) }, perDay: { cost: usd(5) } })
        .build();
    }
  }

  it("settings() returns the limits set through the builder", () => {
    expect(new TestWorkflow().settings().limits).toEqual({
      perRun: { cost: 0.5 },
      perDay: { cost: 5 },
    });
    expect(WorkflowSettings.builder().build().limits).toEqual({});
  });

  it("steps are not a money limit: they are @Workflow({ maxSteps })", () => {
    expect(() => WorkflowSettings.builder().limits({ perRun: { steps: 3 } } as never)).toThrow(
      WorkflowSettingsError,
    );
  });

  it("usd, seconds and minutes carry checked amounts", () => {
    expect([usd(0.5), seconds(2), minutes(1)]).toEqual([0.5, 2000, 60_000]);
    expect(() => usd(-1)).toThrow(UnitError);
    expect(() => seconds(Number.NaN)).toThrow(UnitError);
  });
});

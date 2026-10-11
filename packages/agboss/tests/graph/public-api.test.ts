import { describe, expect, it } from "vitest";
import * as graph from "../../src/graph/index.js";
import * as root from "../../src/index.js";
import * as units from "../../src/units/index.js";

describe("AC1: the flow DSL (root entry since #195) and agboss/units", () => {
  it("export the flow DSL, @WorkflowStart, @Router, @WorkflowFinish, settings and errors", () => {
    const expected = [
      "End",
      "GraphRuleError",
      "LimitExceededError",
      "Router",
      "RouterDecisionError",
      "SELF_OPTION",
      "Self",
      "Return",
      "WorkflowFinish",
      "WorkflowSettings",
      "WorkflowSettingsError",
      "WorkflowStart",
      "background",
      "bg",
      "chain",
      "from",
      "node",
      "optional",
      "parallel",
    ].sort();

    expect(Object.keys(root)).toEqual(expect.arrayContaining(expected));
    // agboss/graph is deprecated (#195): the same values, re-exported from the root
    expect(Object.keys(graph).sort()).toEqual(expected);
    expected.forEach((name) => {
      expect(graph[name as keyof typeof graph]).toBe(root[name as keyof typeof root]);
    });
  });

  it("export the unit helpers", () => {
    expect(Object.keys(units).sort()).toEqual(["UnitError", "minutes", "seconds", "usd"].sort());
  });
});

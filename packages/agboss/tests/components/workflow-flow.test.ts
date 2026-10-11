import { describe, expect, it } from "vitest";
import { Agent, Workflow, ComponentError } from "../../src/index.js";
import { workflowOf } from "../../src/testing/index.js";
import { recordComponent } from "../../src/components/metadata.js";
import { from, node } from "../../src/graph/flow.js";
import { Router } from "../../src/graph/router.decorator.js";
import { GraphRuleError } from "../../src/graph/rule-error.js";
import { WorkflowSettings, type WorkflowDefinition } from "../../src/graph/settings.js";
import { usd } from "../../src/units/index.js";
import { TestAnswer, TestChat } from "../fixtures/test-flow/test.flow.js";
import { TestSettings } from "../fixtures/test-flow/star.js";
import { testConfig } from "../helpers.js";

const price = testConfig.agents.alpha.price;

const prompt = "./fixture/greeter.prompt.md";

@Agent({ name: "profiler", description: "Profiles", model: "test/alpha", price, prompt: "" })
class Profiler {}

@Agent({ name: "scout", description: "Scouts", model: "test/alpha", price, prompt: "" })
class Scout {}

@Router({
  name: "main",
  description: "Picks an agent",
  prompt: "Pick one.",
  model: "typesafe/jev-1.13",
  maxVisits: 3,
  routes: [
    { prompt: "Profiling", target: Profiler },
    { prompt: "Done", target: TestAnswer },
  ],
})
class Main {}

/** The profiler's second place in a flow — declared once, as a constant. */
const SecondLook = node(Profiler, "second-look");

const base = {
  version: "1.0.0",
  defaults: testConfig.defaults,
};

describe("AC1: a workflow's graph is its flow, checked at assembly", () => {
  it("M2: a cycle without a router — reported with its classes", async () => {
    @Workflow({
      ...base,
      name: "broken",
      flow: [
        from(TestChat).next(Main),
        from(Main).routes(),
        from(Profiler).next(Scout),
        from(Scout).next(Profiler),
      ],
    })
    class Broken extends TestSettings {}

    const error: unknown = await workflowOf(Broken).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GraphRuleError);
    const codes = error instanceof GraphRuleError ? error.violations.map((v) => v.code) : [];
    expect(codes).toEqual(["graph.cycle-without-router"]);
    expect(String(error)).toContain("Profiler");
    expect(String(error)).toContain("Scout");
  });

  it("the agents are the flow's agent nodes; limits come from settings(); routers are loaded", async () => {
    class Limited implements WorkflowDefinition {
      settings(): WorkflowSettings {
        return WorkflowSettings.builder()
          .limits({ perRun: { cost: usd(1) }, perDay: { cost: usd(3) } })
          .build();
      }
    }
    @Workflow({
      ...base,
      name: "two-places",
      flow: [
        from(TestChat).next(Main),
        from(Main).routes(),
        from(Profiler).next(SecondLook),
        from(SecondLook).next(Main),
      ],
    })
    class TwoPlaces extends Limited {}

    const workflow = await workflowOf(TwoPlaces);

    expect(Object.keys(workflow.config.agents)).toEqual(["profiler", "second-look"]);
    expect(workflow.limits).toEqual({ perRun: { cost: 1 }, perDay: { cost: 3 } });
    const routerTexts = await Promise.all(
      workflow.routers.map(async (r) => [r.name, await r.instructions({} as any)]),
    );
    expect(routerTexts).toEqual([["main", "Pick one."]]);
  });

  it("a @Workflow class without settings() is refused", async () => {
    class NoSettings {
      readonly kind = "not a workflow definition";
    }
    recordComponent(NoSettings, {
      kind: "workflow",
      meta: {
        ...base,
        name: "no-settings",
        flow: [from(TestChat).next(Profiler), from(Profiler).next(TestAnswer)],
      },
    });

    await expect(workflowOf(NoSettings)).rejects.toThrow(ComponentError);
    await expect(workflowOf(NoSettings)).rejects.toThrow("implement WorkflowDefinition");
  });
});

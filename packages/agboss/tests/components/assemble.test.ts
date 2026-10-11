import { file } from "../../src/components/file.js";

import { describe, expect, it } from "vitest";
import {
  Agent,
  Workflow,
  Injectable,
  ROUTER_FACTORY,
  provide,
  ComponentError,
  Guardrail,
  Tool,
} from "../../src/index.js";
import { workflowOf, toolOf } from "../../src/testing/index.js";
import { checkGraph, createContainer } from "../../src/components/container.js";
import { recordComponent } from "../../src/components/metadata.js";
import type { WorkflowServices } from "../../src/workflow.js";
import type { ToolContext } from "../../src/tools/index.js";
import type { ToolHandlerClass } from "../../src/components/decorators.js";
import type { FlowNodeClass } from "../../src/graph/flow.js";
import { testConfig } from "../helpers.js";
import {
  FilesServer,
  Greeter,
  GreeterAgent,
  Greetings,
  GreetTool,
  GREETING,
} from "./fixture/components.js";
import { starOf, TestSettings } from "../fixtures/test-flow/star.js";

const services: WorkflowServices = {
  router: (name) => ({ name, route: () => Promise.reject(new Error("unused")) }),
};
const ctx: ToolContext = {
  run: testRunContext(),
  runId: "r",
  workflow: "b",
  agent: "a",
  callId: "call-1",
  signal: new AbortController().signal,
  pause: () => ({}),
  reportCost: () => undefined,
};

const baseBundle = {
  version: "1.0.0",
  defaults: testConfig.defaults,
};

describe("components — assembly", () => {
  it("AC1: a tool is one annotated class referenced by an agent; the container injects its dependencies", async () => {
    const bundle = await workflowOf(Greetings);
    const tools = typeof bundle.tools === "function" ? bundle.tools(services) : bundle.tools;
    const greet = tools.find((tool) => tool.name === "greet");

    expect(bundle.config.agents.greeter?.tools).toEqual(["greet", "read_file"]);
    expect(await greet?.invoke({ name: "Pavel" }, ctx)).toEqual({
      kind: "ok",
      value: { text: "Shalom, Pavel" },
    });
  });

  it("AC1: a tool is testable with plain `new` and fakes — no container", async () => {
    const tool = toolOf(new GreetTool(new Greeter("Hi", services.router)));

    expect(await tool.invoke({ name: "you" }, ctx)).toEqual({
      kind: "ok",
      value: { text: "Hi, you" },
    });
    expect((await tool.invoke({ nope: 1 }, ctx)).kind).toBe("error");
  });

  it("AC2: agents (settings, prompt file with variables) and MCP servers come from their classes", async () => {
    const bundle = await workflowOf(Greetings);

    expect(bundle.config).toMatchObject({
      name: "greetings",
      version: "1.0.0",
      mcpServers: { files: { transport: "stdio", command: "files-server" } },
    });
    expect(bundle.config.agents.greeter).toMatchObject({
      model: "test/alpha",
      thinking: "low",
      description: "Greets people",
    });
    const text =
      typeof bundle.prompts.greeter === "function"
        ? await bundle.prompts.greeter({} as any)
        : bundle.prompts.greeter;
    expect(text?.trim()).toBe("You greet people in Hebrew.");
    expect(bundle.mcpServers.map((server) => server.name)).toEqual(["files"]);
  });
});

import { Person, Greeting } from "./fixture/components.js";
import { testRunContext } from "../../src/testing/index.js";

describe("components — policy overrides and disables", () => {
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class WGuard {}
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class AGuard {}
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class TGuard {}
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class WDisable {}

  // eslint-disable-next-line complexity
  it("Agent inherits workflow guardrails by default, or overrides them", async () => {
    @Agent({
      name: "override_agent",
      description: "d",
      model: "test/alpha",
      price: testConfig.agents.alpha.price,
      tools: [],
      prompt: "hi",
      overrideGuardrails: [AGuard],
      disableGuardrails: [WDisable],
    })
    class OverrideAgent {}

    @Agent({
      name: "normal_agent",
      description: "d",
      model: "test/alpha",
      price: testConfig.agents.alpha.price,
      tools: [],
      prompt: "hi",
      guardrails: [AGuard],
    })
    class NormalAgent {}

    @Workflow({
      ...baseBundle,
      name: "w",
      flow: starOf(OverrideAgent, NormalAgent),
      guardrails: [WGuard, WDisable],
    })
    class W extends TestSettings {}

    const bundle = await workflowOf(W);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    const mockServices = { resolve: (cls: any) => new cls(), router: () => ({}) as any };
    const agentMap = bundle.guardrails?.(mockServices);

    const over = agentMap?.get("override_agent");
    expect(over?.override).toBe(true);
    expect(over?.instances.length).toBe(1);
    expect(over?.instances[0]).toBeInstanceOf(AGuard);
    expect(over?.disable).toEqual([WDisable]);

    const norm = agentMap?.get("normal_agent");
    expect(norm?.override).toBe(false);
    expect(norm?.instances.length).toBe(1);
    expect(norm?.instances[0]).toBeInstanceOf(AGuard);
    expect(norm?.disable).toEqual([]);
  });

  it("Tool inherits workflow and agent guardrails by default, or overrides them", async () => {
    @Tool({
      name: "t1",
      description: "d",
      input: Person,
      output: Greeting,
      overrideGuardrails: [TGuard],
      disableGuardrails: [WDisable],
    })
    class T1 {
      async run(input: any, ctx: any): Promise<any> {
        return { kind: "ok", value: {} as any };
      }
    }

    @Agent({
      name: "a1",
      description: "d",
      model: "test/alpha",
      price: testConfig.agents.alpha.price,
      tools: [T1],
      prompt: "hi",
    })
    class A1 {}

    @Workflow({
      ...baseBundle,
      name: "w2",
      flow: starOf(A1),
      guardrails: [WGuard, WDisable],
    })
    class W2 extends TestSettings {}

    const bundle = await workflowOf(W2);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    const mockServices = { resolve: (cls: any) => new cls(), router: () => ({}) as any };
    const toolMap = bundle.toolGuardrails?.(mockServices);

    const tGuard = toolMap?.get("t1");
    expect(tGuard?.override).toBe(true);
    expect(tGuard?.instances.length).toBe(1);
    expect(tGuard?.instances[0]).toBeInstanceOf(TGuard);
    expect(tGuard?.disable).toEqual([WDisable]);
  });
});

describe("components — errors at assembly", () => {
  it("AC3: unknown prompt variables fail at assembly", async () => {
    @Agent({
      name: "tester",
      description: "d",
      model: "test/alpha",
      price: testConfig.agents.alpha.price,
      tools: [],
      prompt: "Hello {{unknown_var}}",
      promptVariables: {},
    })
    class Tester {}

    @Workflow({
      ...baseBundle,
      name: "tester-flow",
      flow: starOf(Tester),
    })
    class TesterFlow extends TestSettings {}

    await expect(workflowOf(TesterFlow)).rejects.toThrow(
      '[prompt.unknown-variable] @Agent "tester" prompt:1 {{unknown_var}} — known: item',
    );
  });

  it("AC3: an unregistered provider names the component", async () => {
    @Workflow({
      ...baseBundle,
      name: "no-providers",
      flow: starOf(GreeterAgent),
      mcp: [FilesServer],
    })
    class NoProviders extends TestSettings {}

    await expect(workflowOf(NoProviders)).rejects.toThrow(
      'GreetTool: "Greeter" is not registered in @Workflow({ providers })',
    );
  });

  it("AC3: a dependency cycle names the chain", () => {
    const deps: { a?: unknown; b?: unknown } = {};
    @Injectable({ deps: [] })
    class A {}
    @Injectable({ deps: [] })
    class B {}
    recordComponent(A, { kind: "injectable", meta: { deps: [B] } });
    recordComponent(B, { kind: "injectable", meta: { deps: [A] } });

    expect(() => {
      checkGraph([A], [A, B], []);
    }).toThrow("Dependency cycle: A → B → A");
    expect(deps).toEqual({});
  });

  it("AC3: a non-component in tools fails", async () => {
    /** Shaped like a tool (the compiler accepts it), but not decorated: the assembly rejects it. */
    class Plain {
      run(): Promise<object> {
        return Promise.resolve({});
      }
    }

    const agent = (prompt: any, tools: ToolHandlerClass[] = []) => {
      @Agent({
        name: "a",
        description: "d",
        model: "test/alpha",
        price: testConfig.agents.alpha.price,
        tools,

        prompt: prompt,
      })
      class A {}
      return A;
    };
    const bundleWith = (agentClass: FlowNodeClass) => {
      @Workflow({ ...baseBundle, name: "x", flow: starOf(agentClass) })
      class B extends TestSettings {}
      return B;
    };
    const prompt = file("./fixture/greeter.prompt.md");

    await expect(workflowOf(bundleWith(agent(prompt, [Plain])))).rejects.toThrow(
      /Plain in an agent's tools is not a @Tool/,
    );
  });

  it("AC3: instances are created once, dependencies before dependants", () => {
    const container = createContainer(
      [Greeter, provide(GREETING, "Hey")],
      new Map([[ROUTER_FACTORY, services.router]]),
    );
    const first = container.get(GreetTool);

    expect(container.get(GreetTool)).toBe(first);
    expect(container.created).toEqual(["Greeter", "GreetTool"]);
  });
});

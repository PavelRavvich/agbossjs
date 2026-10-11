/**
 * #183 AC2/AC3: DI holes are assembly errors — a missing provider of any component kind, an
 * undecorated provider class, a tool shadowing a RAG search tool; a raw `useValue` literal is a
 * compile error.
 */
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app/create-app.js";
import {
  Channel,
  Guardrail,
  InboundChannelAdapter,
  PiiPolicy,
  Rag,
  WorkflowAction,
  type ChannelHandler,
  type IWorkflowAction,
} from "../../src/components/decorators.js";
import { Judge, type JudgeHandler } from "../../src/components/judge-decorators.js";
import { type Provider } from "../../src/components/injection.js";
import { Agent, InjectionToken, provide, from, Tool, type ToolHandler } from "../../src/index.js";
import { Text } from "../../src/dto/index.js";
import type { RagRetrieval } from "../../src/rag/types.js";
import { Chat, Done, offline, workflowWith } from "./fixture/deps-contract.workflow.js";

const MISSING = new InjectionToken<string>("MISSING");
const notRegistered = (consumer: string): string =>
  `${consumer}: "MISSING" is not registered in @Workflow({ providers })`;

@Guardrail({ name: "needs", deps: [MISSING] })
class NeedsGuardrail implements Guardrail {
  constructor(readonly value: string) {}
  beforeAgentAnswer(): Promise<void> {
    return Promise.resolve();
  }
}

@PiiPolicy({ name: "needs-pii", deps: [MISSING] })
class NeedsPolicy implements PiiPolicy {
  constructor(readonly value: string) {}
  mask(text: string): Promise<string> {
    return Promise.resolve(text);
  }
  maskJson(obj: unknown): Promise<unknown> {
    return Promise.resolve(obj);
  }
}

@WorkflowAction({ name: "needs-action", deps: [MISSING] })
class NeedsAction implements IWorkflowAction {
  constructor(readonly value: string) {}
  execute(): Record<string, never> {
    return {};
  }
}

@InboundChannelAdapter({ name: "needs-inbound", deps: [MISSING] })
class NeedsInbound implements InboundChannelAdapter {
  constructor(readonly value: string) {}
  interpret(): Promise<{ approved: boolean }> {
    return Promise.resolve({ approved: true });
  }
}

@Channel({ name: "needs-channel", deps: [MISSING] })
class NeedsChannel implements ChannelHandler {
  constructor(readonly value: string) {}
  requestApproval(): Promise<void> {
    return Promise.resolve();
  }
}

@Channel({ name: "adapted", inboundAdapter: NeedsInbound })
class AdaptedChannel implements ChannelHandler {
  requestApproval(): Promise<void> {
    return Promise.resolve();
  }
}

@Judge({ name: "needs-judge", model: "test/j", deps: [MISSING] })
class NeedsJudge implements JudgeHandler {
  constructor(readonly value: string) {}
  judge(): Promise<{ passed: boolean }> {
    return Promise.resolve({ passed: true });
  }
}

@Agent({ name: "guarded", description: "d", model: "test/g", piiPolicies: [NeedsPolicy] })
class PolicedAgent {}

@Agent({ name: "judged", description: "d", model: "test/j", judges: [NeedsJudge] })
class JudgedAgent {}

const assemble = (workflow: Parameters<typeof createApp>[0]) => createApp(workflow, offline());

describe("#183 AC2: a missing provider fails at assembly, naming the consumer and the token", () => {
  it.each([
    ["a workflow guardrail", workflowWith("g", { guardrails: [NeedsGuardrail] }), "NeedsGuardrail"],
    ["an agent's PII policy", workflowWith("p", {}, PolicedAgent), "NeedsPolicy"],
    ["a channel", workflowWith("c", { channelClasses: [NeedsChannel] }), "NeedsChannel"],
    [
      "a channel's inbound adapter",
      workflowWith("i", { channelClasses: [AdaptedChannel] }),
      "NeedsInbound",
    ],
    ["an agent's judge", workflowWith("j", {}, JudgedAgent), "NeedsJudge"],
    [
      "a workflow action",
      workflowWith("a", { flow: [from(Chat).next(NeedsAction), from(NeedsAction).next(Done)] }),
      "NeedsAction",
    ],
  ])("%s", async (_kind, workflow, consumer) => {
    await expect(assemble(workflow)).rejects.toThrow(notRegistered(consumer));
  });
});

class Topic {
  @Text({ prompt: "the topic" })
  topic!: string;
}

@Rag({ name: "manuals", description: "Manuals", topK: 1 })
class Manuals {
  retrieve(): Promise<RagRetrieval> {
    return Promise.resolve({ results: [] });
  }
}

@Tool({ name: "search_manuals", description: "Shadows", input: Topic, output: Topic })
class ShadowSearch implements ToolHandler<Topic, Topic> {
  run(input: Topic): Promise<Topic> {
    return Promise.resolve(input);
  }
}

@Agent({
  name: "reader",
  description: "d",
  model: "test/r",
  tools: [ShadowSearch],
  rag: [{ use: Manuals, mode: "tool" }],
})
class Reader {}

describe("#183 AC3: tool names are unique over the exposed names", () => {
  it("a tool named like a RAG search tool (search_<rag>) fails at assembly", async () => {
    await expect(assemble(workflowWith("shadow", {}, Reader))).rejects.toThrow(
      '[tool.duplicate-name] Duplicate tool name "search_manuals" found in classes ShadowSearch and Manuals',
    );
  });
});

class Plain {
  readonly label = "plain";
}

class Defaulted {
  constructor(readonly label = "defaulted") {}
}

describe("#183: providers are decorated classes or provide() values", () => {
  it.each([
    ["a zero-argument class", Plain],
    ["a class whose constructor has only default parameters", Defaulted],
  ])("%s in providers fails at assembly", async (_kind, cls) => {
    await expect(assemble(workflowWith("undecorated", { providers: [cls] }))).rejects.toThrow(
      `[di.undecorated-provider] @Workflow "undecorated": ${cls.name} in providers has no decorator`,
    );
  });

  it("a raw { provide, useValue } literal is a compile error; provide() builds the value", () => {
    // @ts-expect-error — a ValueProvider is built only by provide()
    const raw: Provider = { provide: MISSING, useValue: "x" };
    const built: Provider = provide(MISSING, "x");
    expect("provide" in built ? built.useValue : undefined).toBe("x");
    expect("useValue" in raw).toBe(true);
  });

  it("@WorkflowAction deps are checked against the constructor by the compiler", () => {
    // @ts-expect-error — the constructor takes a string; MISSING gives a string, Plain an instance
    @WorkflowAction({ name: "mismatch", deps: [Plain] })
    class Mismatch implements IWorkflowAction {
      constructor(readonly value: string) {}
      execute(): Record<string, never> {
        return {};
      }
    }
    expect(Mismatch.name).toBe("Mismatch");
  });
});

import { describe, expect, expectTypeOf, it } from "vitest";
import type { App } from "../../src/app/types.js";
import {
  Agent,
  Guardrail,
  Injectable,
  Judge,
  WorkflowFinish,
  WorkflowStart,
  type StartInputOf,
  Tool,
  type ToolHandler,
} from "../../src/index.js";
import type { JudgeContext, JudgeVerdict } from "../../src/index.js";
import { Text, WorkflowFinishTextDto, WorkflowStartTextDto } from "../../src/dto/index.js";
import { MainRouter, Support } from "../testing/fixtures/desk.workflow.js";
import { execute } from "../helpers/flow.js";

/**
 * #200 D4: compile-time checks. Each `@ts-expect-error` below is a negative type test — tsc fails
 * this file if the line compiles. The runtime side is in tests/app and tests/graph.
 */
class ChatIn extends WorkflowStartTextDto {
  @Text({ prompt: "the reply language" })
  locale!: string;
}

@WorkflowStart({ name: "chat-workflow-start", description: "A message", input: ChatIn })
class ChatWorkflowStart {}

// @ts-expect-error -- a start declares its input DTO for the compiler (`declare readonly input`)
@WorkflowStart({
  name: "bare-workflow-start",
  description: "No declared input",
  input: WorkflowStartTextDto,
})
class BareStart {}

/** A service: it has methods, but it is no tool, judge, guardrail or flow node. */
@Injectable()
class JobFitJudge {
  rate(job: string): Promise<number> {
    return Promise.resolve(job.length);
  }
}

class Query {
  @Text() q!: string;
}

@Tool({ name: "search", description: "Searches", input: Query, output: Query })
class Search implements ToolHandler<Query, Query> {
  run(input: Query): Promise<Query> {
    return Promise.resolve(input);
  }
}

@Judge({ name: "fair", model: "test/judge" })
class Fair {
  judge(_reply: string, _ctx: JudgeContext): Promise<JudgeVerdict> {
    return Promise.resolve({ passed: true });
  }
}

@Guardrail({ name: "polite" })
class Polite {
  beforeAgentAnswer(): Promise<void> {
    return Promise.resolve();
  }
}

class RichOut extends WorkflowFinishTextDto {
  @Text() score!: string;
}

/** Never called: only compiled. */
function callers(app: App): void {
  void execute(app, ChatWorkflowStart, { text: "hi", locale: "he" });
  // @ts-expect-error -- `locale` is required by ChatIn, the start's input
  void execute(app, ChatWorkflowStart, { text: "hi" });
  // @ts-expect-error -- Support is an @Agent, not a @WorkflowStart
  void execute(app, Support, { text: "hi" });
}

describe("#200 AC1: execute is typed from the start and finish DTOs", () => {
  it("the input is the start's declared DTO; the output is the finish's text DTO", () => {
    expectTypeOf<StartInputOf<typeof ChatWorkflowStart>>().toEqualTypeOf<ChatIn>();
    expectTypeOf<Parameters<typeof callers>[0]["execute"]>().toBeFunction();
    expectTypeOf<Awaited<ReturnType<App["execute"]>>["output"]>().toEqualTypeOf<
      WorkflowFinishTextDto | undefined
    >();
    expect(BareStart.name).toBe("BareStart");
  });

  it("a finish DTO may add optional fields only — a required one is a compile error", () => {
    // @ts-expect-error -- a run fills only `text`, so RichOut's required `score` is never produced
    @WorkflowFinish({ name: "rich-workflow-finish", description: "Rich", output: RichOut })
    class RichFinish {}

    expect(RichFinish.name).toBe("RichFinish");
  });
});

describe("#200 AC2: slots are typed by component kind", () => {
  it("tools, judges and guardrails take their kind only", () => {
    @Agent({
      name: "typed-agent",
      description: "Typed slots",
      model: "test/alpha",
      prompt: "p",
      tools: [Search],
      judges: [Fair],
      guardrails: [Polite],
    })
    class Typed {}

    @Agent({
      name: "wrong-agent",
      description: "A service in every slot",
      model: "test/alpha",
      prompt: "p",
      // @ts-expect-error -- JobFitJudge is not a @Tool (no `run`)
      tools: [JobFitJudge],
      // @ts-expect-error -- JobFitJudge is not a @Judge (no `judge`)
      judges: [JobFitJudge],
      // @ts-expect-error -- JobFitJudge is not a @Guardrail (no guardrail hook)
      guardrails: [JobFitJudge],
    })
    class Wrong {}

    expect([Typed.name, Wrong.name]).toEqual(["Typed", "Wrong"]);
  });

  it("a service or a tool in the flow is a compile error; routes() takes no targets", () => {
    const flow = [
      from(ChatWorkflowStart).next(MainRouter),
      // @ts-expect-error -- a service is not a flow node
      from(Support).next(JobFitJudge),
      // @ts-expect-error -- a tool is not a flow node
      from(Search).next(MainRouter),
      // @ts-expect-error -- the router's targets are its @Router({ routes }), not arguments
      from(MainRouter).routes(Support),
    ];

    expect(flow).toHaveLength(4);
  });
});

import { describe, expect, it } from "vitest";
import { Agent, Guardrail, Injectable, Judge, Tool, type ToolHandler } from "../../src/index.js";
import type { JudgeInput, JudgeVerdict } from "../../src/index.js";
import { Text } from "../../src/dto/index.js";

/**
 * #200 D4: compile-time checks of an agent's slots. Each `@ts-expect-error` below is a negative type
 * test — tsc fails this file if the line compiles. The flow's own compile-time checks (starts,
 * finishes, steps) are in tests/flow/types.test-d.ts and tests/flow/types/compile.test-d.ts.
 */
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
  judge(_input: JudgeInput): Promise<JudgeVerdict> {
    return Promise.resolve({ passed: true });
  }
}

@Guardrail({ name: "polite" })
class Polite {
  beforeAgentAnswer(): Promise<void> {
    return Promise.resolve();
  }
}

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
});

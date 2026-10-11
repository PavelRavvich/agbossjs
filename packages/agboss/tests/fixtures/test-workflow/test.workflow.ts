import { Agent, Workflow, MODEL_MAX, Tool, type ToolHandler } from "../../../src/index.js";
import { DateTime, TimeZone } from "../../../src/dto/index.js";
import { starOf, TestSettings } from "../test-flow/star.js";

const price = { inputPerMTok: 0.5, outputPerMTok: 3, cacheReadPerMTok: 0.1 };
class ClockQuery {
  @TimeZone({ prompt: "IANA time zone, e.g. Asia/Tokyo", default: "UTC" })
  timeZone!: string;
}

class ClockTime {
  @DateTime()
  iso!: string;

  @TimeZone()
  timeZone!: string;
}

/** A test tool: the time, from an injected clock. */
@Tool({
  name: "current_time",
  description: "Current date and time in an IANA time zone (default UTC).",
  input: ClockQuery,
  output: ClockTime,
})
export class Clock implements ToolHandler<ClockQuery, ClockTime> {
  constructor(private readonly now: () => Date = () => new Date("2026-09-25T10:00:00Z")) {}
  run({ timeZone }: ClockQuery): Promise<ClockTime> {
    // an unknown time zone throws — the model sees it as a tool error
    new Intl.DateTimeFormat("en-GB", { timeZone }).format(this.now());
    return Promise.resolve({ iso: this.now().toISOString(), timeZone });
  }
}

@Agent({
  name: "researcher",
  description: "Finds, explains and summarizes facts",
  model: "test/researcher",
  price,
  tools: [Clock],
  promptUrls: ["./researcher.prompt.md"],
})
export class Researcher {}

@Agent({
  name: "coder",
  description: "Writes, reviews and explains code",
  model: "test/coder",
  price,
  thinking: "low",
  promptUrls: ["./coder.prompt.md"],
})
export class Coder {}

/** The framework's own test workflow (the framework ships no agents). */
@Workflow({
  name: "test-workflow",
  version: "1.0.0",
  defaults: {
    models: { temperature: 0, maxTokens: MODEL_MAX, thinking: "default", cache: true },
    router: { kind: "jev", model: "typesafe/jev-1.13" },
    tools: { maxToolCalls: 8 },
    history: { limit: 5 },
  },
  guards: {
    input: { prompt_injection: { threshold: 0.7, refusal: "I can't help with that request." } },
    output: { pii: { threshold: 0.7, refusal: "Withheld." } },
  },
  flow: starOf(Researcher, Coder),
})
export class TestWorkflow extends TestSettings {}

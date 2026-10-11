import {
  Agent,
  Workflow,
  WorkflowAction,
  BatchParallelStrategy,
  from,
  WorkflowFinish,
  WorkflowSettings,
  WorkflowStart,
  type Flow,
  type WorkflowDefinition,
  Tool,
  type ToolHandler,
  MODEL_MAX,
} from "../../../src/index.js";
import type { ActionRuntime } from "../../../src/components/decorators.js";
import { TerminalUserChannel } from "../../../src/channels/terminal-channel.js";
import { Text, WorkflowFinishText, WorkflowStartText } from "../../../src/dto/index.js";
import type { FlowStateType } from "../../../src/graph/flow-state.js";
import type { AgentState, AgentStateUpdate } from "../../../src/graph/state.js";

/** The items of a run: the comma-separated cities of the start text, as objects. */
@BatchParallelStrategy()
export class Cities {
  extract(state: FlowStateType): { city: string }[] {
    return state.task.split(",").map((city) => ({ city: city.trim() }));
  }
}

/** The items of a run as plain strings. */
@BatchParallelStrategy()
export class Words {
  extract(state: FlowStateType): string[] {
    return state.task.split(",").map((word) => word.trim());
  }
}

/** Not decorated: assembly rejects it as a strategy. */
export class PlainStrategy {
  extract(): string[] {
    return [];
  }
}

@WorkflowStart({ name: "cities", description: "Comma-separated items", input: WorkflowStartText })
export class ItemsStart {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "done", description: "The result", output: WorkflowFinishText })
export class Done {}

@Agent({
  name: "guide",
  prompt: "Write one line about this city: {{item}}",
  description: "Writes about one city",
  model: "test/guide",
})
export class Guide {}

@Agent({
  name: "editor",
  prompt: "Join the lines.",
  description: "Joins the lines",
  model: "test/editor",
})
export class Editor {}

/** What the `Tally` action saw, per run of the test. */
export const tallied: unknown[] = [];
/** The idempotency keys the `Tally` action got, per run of the test. */
export const tallyKeys: string[] = [];

@WorkflowAction({ name: "tally", description: "Records its item" })
export class Tally {
  execute(_state: AgentState, context: ActionRuntime): Partial<AgentStateUpdate> {
    tallied.push(context.item);
    tallyKeys.push(context.idempotencyKey);
    return { contributions: [{ agent: "tally", content: `seen ${String(context.item)}` }] };
  }
}

export class Filing {
  @Text({ prompt: "what to file" })
  text!: string;
}

/** A tool that needs approval: an agent calling it pauses the run. */
@Tool({
  name: "file_item",
  description: "Files an item",
  input: Filing,
  output: Filing,
  channel: TerminalUserChannel,
})
export class FileItem implements ToolHandler<Filing, Filing> {
  run(input: Filing): Promise<Filing> {
    return Promise.resolve(input);
  }
}

@Agent({
  name: "clerk",
  prompt: "File this item: {{item}}",
  description: "Files one item",
  model: "test/clerk",
  tools: [FileItem],
})
export class Clerk {}

const defaults = {
  models: { temperature: 0, maxTokens: MODEL_MAX, thinking: "default", cache: true },
  router: { kind: "jev", model: "typesafe/jev-1.13" },
  tools: { maxToolCalls: 4 },
  history: { limit: 4 },
} as const;

class Limits implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder()
      .limits({ perRun: { steps: 20 } })
      .build();
  }
}

/** Each city goes to its own `Guide` run (two at a time), then the editor joins the lines. */
@Workflow({
  name: "city-guide",
  version: "1.0.0",
  flow: [
    from(ItemsStart).batchParallel(Guide, Cities, { concurrencyLimit: 2, batchSize: 1 }),
    from(Guide).next(Editor),
    from(Editor).next(Done),
  ],
  defaults,
})
export class CityGuide extends Limits {}

/** Each word goes to its own `Tally` action run, all at once; then the editor sums up. */
@Workflow({
  name: "tally-words",
  version: "1.0.0",
  flow: [
    from(ItemsStart).batchParallel(Tally, Words, { concurrencyLimit: 3, batchSize: 1 }),
    from(Tally).next(Editor),
    from(Editor).next(Done),
  ],
  defaults,
})
export class TallyWords extends Limits {}

/** `batchSize: 2`: each `Tally` run gets a batch of up to two words, one run at a time. */
@Workflow({
  name: "tally-pairs",
  version: "1.0.0",
  flow: [
    from(ItemsStart).batchParallel(Tally, Words, { concurrencyLimit: 1, batchSize: 2 }),
    from(Tally).next(Editor),
    from(Editor).next(Done),
  ],
  defaults,
})
export class TallyPairs extends Limits {}

/** One `Clerk` run per word, one at a time; filing needs approval, so a run pauses mid-batch. */
@Workflow({
  name: "filing",
  version: "1.0.0",
  flow: [
    from(ItemsStart).batchParallel(Clerk, Words, { concurrencyLimit: 1, batchSize: 1 }),
    from(Clerk).next(Done),
  ],
  defaults,
  channelClasses: [TerminalUserChannel],
})
export class Filings extends Limits {}

/** A batch step with the given options and strategy (for the assembly rules). */
export const batchFlow = (
  options: { concurrencyLimit: number; batchSize: number },
  strategy: new () => unknown = Words,
): Flow => [from(ItemsStart).batchParallel(Tally, strategy, options), from(Tally).next(Done)];

/** batchSize 0 and an undecorated strategy: `createApp` must refuse it. */
@Workflow({
  name: "bad-batch",
  version: "1.0.0",
  flow: batchFlow({ concurrencyLimit: 2, batchSize: 0 }, PlainStrategy),
  defaults,
})
export class BadBatch extends Limits {}

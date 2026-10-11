import {
  Agent,
  Injectable,
  Workflow,
  chain,
  WorkflowFinish,
  WorkflowSettings,
  WorkflowStart,
  type WorkflowDefinition,
  MODEL_MAX,
} from "../../../src/index.js";
import { InjectionToken, provide } from "../../../src/components/injection.js";
import { WorkflowFinishText, WorkflowStartText } from "../../../src/dto/index.js";
import {
  BaseMemoryStrategy,
  SlidingWindowStrategy,
  type MemoryContext,
  type MemoryTurn,
  type MemoryUpdate,
  type MemoryView,
} from "../../../src/memory/index.js";
import { DecisionsModelProvider } from "../../../src/models/index.js";
import { LocalModelProvider } from "../../models/providers.fixture.js";

/** Where the noting strategy keeps what it saw (a provider value, so tests read it). */
export const NOTES = new InjectionToken<string[]>("NOTES");
export const NOTED: string[] = [];

/** A custom strategy with a dependency: sees no summaries, the last turn only; notes every turn. */
@Injectable({ deps: [NOTES] })
export class NotingStrategy extends BaseMemoryStrategy {
  constructor(private readonly notes: string[]) {
    super();
  }

  buildContext({ history }: MemoryContext): MemoryView {
    return { summaries: [], history: history.slice(-1) };
  }

  override updateMemory({ turn }: MemoryTurn): Promise<MemoryUpdate> {
    this.notes.push(turn.task);
    return Promise.resolve({});
  }
}

/** A fixed sliding window of two turns. */
export class LastTwoTurns extends SlidingWindowStrategy {
  constructor() {
    super({ turns: 2 });
  }
}

@Agent({ name: "recaller", prompt: "Recall.", description: "Recalls", model: "local/llama" })
export class Recaller {}

@Agent({
  name: "windowed",
  prompt: "Window.",
  description: "Sees two turns",
  model: "local/llama",
  memoryStrategy: LastTwoTurns,
})
export class Windowed {}

@Agent({
  name: "noter",
  prompt: "Note.",
  description: "Uses its own strategy",
  model: "local/llama",
  memoryStrategy: NotingStrategy,
})
export class Noter {}

@WorkflowStart({ name: "task", description: "A task", input: WorkflowStartText })
export class TaskStart {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "replyWith", description: "The reply", output: WorkflowFinishText })
export class Answer {}

const DEFAULTS = {
  models: { temperature: 0, maxTokens: MODEL_MAX },
  router: { kind: "jev", model: "typesafe/jev-1.13" },
  tools: { maxToolCalls: 2 },
  history: { limit: 4 },
} as const;

const settings = (): WorkflowSettings =>
  WorkflowSettings.builder()
    .modelProviders([DecisionsModelProvider, LocalModelProvider])
    .defaultModelProvider(LocalModelProvider)
    .build();

/** Three agents in a line: the built-in window (4 turns), a fixed window (2), a custom strategy. */
@Workflow({
  name: "memory-desk",
  version: "1.0.0",
  flow: [chain(TaskStart, Recaller, Windowed, Noter, Answer)],
  defaults: DEFAULTS,
  providers: [provide(NOTES, NOTED)],
})
export class MemoryDesk implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return settings();
  }
}

/** One agent; every 2 turns are compacted by a priced model. */
@Workflow({
  name: "compacting-desk",
  version: "1.0.0",
  flow: [chain(TaskStart, Recaller, Answer)],
  defaults: DEFAULTS,
  compaction: { every: 2, keep: 3, model: { model: "local/llama" } },
})
export class CompactingDesk implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return settings();
  }
}

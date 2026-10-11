import { TerminalUserChannel } from "../../../src/channels/terminal-channel.js";
import {
  Agent,
  Tool,
  Workflow,
  WorkflowAction,
  type ActionContext,
} from "../../../src/components/decorators.js";
import type { RunContext } from "../../../src/core/run-context.js";
import { Integer, Text, WorkflowFinishText, WorkflowStartText } from "../../../src/dto/index.js";
import type { AgentState, AgentStateUpdate } from "../../../src/graph/state.js";
import {
  chain,
  Injectable,
  WorkflowFinish,
  WorkflowSettings,
  WorkflowStart,
  type ActionStartEvent,
  type AppState,
  type ExecutionOutput,
  type ModelStartEvent,
  type OnActionStart,
  type OnModelStart,
  type OnToolStart,
  type OnWorkflowEnd,
  type OnWorkflowStart,
  type ToolContext,
  type ToolHandler,
  type ToolStartEvent,
  type WorkflowDefinition,
} from "../../../src/index.js";

/** What the components and the observer saw of their run, in order (reset with `resetSeen`). */
export const seen = {
  tools: [] as RunContext[],
  actions: [] as RunContext[],
  /** `hook:runId` per observer event. */
  events: [] as string[],
};

export function resetSeen(): void {
  for (const list of Object.values(seen)) list.length = 0;
}

/** A start with more than the text: `limit` must reach the run. */
export class SearchIn extends WorkflowStartText {
  @Integer({ prompt: "how many jobs at most", min: 1 })
  limit!: number;
}

export class Query {
  @Text({ prompt: "what to look up" })
  text!: string;
}

/** A read tool: records its run. */
@Tool({ name: "lookup", description: "Looks jobs up", input: Query, output: Query })
export class Lookup implements ToolHandler<Query, Query> {
  run(input: Query, ctx: ToolContext): Promise<Query> {
    seen.tools.push(ctx.run);
    return Promise.resolve(input);
  }
}

/** A write tool: it waits for an approval, so a run pauses before it. */
@Tool({
  name: "apply",
  description: "Applies for a job",
  channel: TerminalUserChannel,
  input: Query,
  output: Query,
})
export class Apply implements ToolHandler<Query, Query> {
  run(input: Query, ctx: ToolContext): Promise<Query> {
    seen.tools.push(ctx.run);
    return Promise.resolve(input);
  }
}

@Agent({
  name: "searcher",
  description: "Finds jobs",
  prompt: "Find jobs. Return at most {{input.limit}} jobs.",
  tools: [Lookup, Apply],
  model: "test/searcher",
})
export class Searcher {}

/** Records the run it is part of. */
@WorkflowAction({ name: "shortlist", description: "Keeps the shortlist" })
export class Shortlist {
  execute(_state: AgentState, ctx: ActionContext): Partial<AgentStateUpdate> {
    seen.actions.push(ctx.run);
    return {};
  }
}

/** Every event's run id. */
@Injectable()
export class RunIds
  implements OnWorkflowStart, OnWorkflowEnd, OnModelStart, OnToolStart, OnActionStart
{
  onWorkflowStart(state: AppState): void {
    seen.events.push(`workflow-start:${state.runId}`);
  }
  onWorkflowEnd(result: ExecutionOutput, state: AppState): void {
    seen.events.push(`workflow-end:${state.runId}`);
  }
  onModelStart(event: ModelStartEvent): void {
    seen.events.push(`model-start:${event.state.runId}`);
  }
  onToolStart(event: ToolStartEvent): void {
    seen.events.push(`tool-start:${event.state.runId}`);
  }
  onActionStart(event: ActionStartEvent): void {
    seen.events.push(`action-start:${event.state.runId}`);
  }
}

@WorkflowStart({ name: "search", description: "A job search", input: SearchIn })
export class SearchStart {
  declare readonly input: SearchIn;
}

@WorkflowFinish({ name: "done", description: "The shortlist", output: WorkflowFinishText })
export class Done {}

class Settings implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder().build();
  }
}

/** search → searcher → shortlist → done, observed. */
@Workflow({
  name: "job-search",
  version: "1.0.0",
  defaults: {
    models: { maxTokens: 100, temperature: 0 },
    history: { limit: 1 },
    tools: { maxToolCalls: 3 },
    router: { kind: "llm" as const, model: "test/router" },
  },
  providers: [Shortlist],
  observers: [RunIds],
  channelClasses: [TerminalUserChannel],
  flow: [chain(SearchStart, Searcher, Shortlist, Done)],
})
export class JobSearch extends Settings {}

@Agent({
  name: "typo",
  description: "Names a field no start has",
  prompt: "Return at most {{input.limt}} jobs.",
  model: "test/typo",
})
export class Typo {}

/** Its agent's prompt names `{{input.limt}}`, which `SearchIn` does not have. */
@Workflow({
  name: "typo-search",
  version: "1.0.0",
  defaults: {
    models: { maxTokens: 100, temperature: 0 },
    history: { limit: 1 },
    router: { kind: "llm" as const, model: "test/router" },
  },
  flow: [chain(SearchStart, Typo, Done)],
})
export class TypoSearch extends Settings {}

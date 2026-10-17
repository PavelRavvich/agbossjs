import { TerminalUserChannel } from "../../../src/channels/terminal-channel.js";
import type { RunContext } from "../../../src/core/run-context.js";
import { Integer, Text, WorkflowStartTextDto } from "../../../src/dto/index.js";
import {
  Action,
  Agent,
  Injectable,
  Tool,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  type ActionContext,
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
} from "../../../src/index.js";
import { start } from "../../helpers/flow.js";

/** What the components and the observer saw of their run, in order (reset with `resetSeen`). */
export const seen = {
  tools: [] as RunContext[],
  actions: [] as RunContext[],
  /** `idempotencyKey` per action call. */
  keys: [] as string[],
  /** `hook:runId` per observer event. */
  events: [] as string[],
};

export function resetSeen(): void {
  for (const list of Object.values(seen)) list.length = 0;
}

/** A start with more than the text: `limit` must reach the run. */
export class SearchInDto extends WorkflowStartTextDto {
  @Integer({ prompt: "how many jobs at most", min: 1 })
  limit!: number;
}

export class ShortlistDto {
  @Text({ prompt: "the jobs kept" })
  text!: string;
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
  name: "searcher-agent",
  description: "Finds jobs",
  prompt: "Find jobs. Return at most `limit` jobs.",
  tools: [Lookup, Apply],
  model: "test/searcher",
  input: { search: SearchInDto },
  output: ShortlistDto,
})
export class Searcher {}

/** Records the run it is part of. */
@Action({ name: "shortlist-action", description: "Keeps the shortlist" })
export class Shortlist {
  execute(_input: unknown, ctx: ActionContext): Promise<void> {
    seen.actions.push(ctx.run);
    seen.keys.push(ctx.idempotencyKey);
    return Promise.resolve();
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
  onWorkflowEnd(_result: ExecutionOutput, state: AppState): void {
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

@WorkflowStart({ name: "search-workflow-start", description: "A job search", input: SearchInDto })
export class SearchStart {}

@WorkflowFinish({
  name: "done-workflow-finish",
  description: "The shortlist",
  output: ShortlistDto,
})
export class Done {}

/** search → searcher → shortlist → done, observed. */
@Workflow({
  name: "job-search-workflow",
  version: "1.0.0",
  defaults: {
    models: { maxTokens: 100, temperature: 0 },
    history: { limit: 1 },
    tools: { maxToolCalls: 3 },
  },
  providers: [Shortlist],
  observers: [RunIds],
  channelClasses: [TerminalUserChannel],
  flow: [
    start(SearchStart)
      .returns(SearchInDto)
      .toAgent(Searcher)
      .returns(ShortlistDto)
      .toAction(Shortlist)
      .toFinish(Done),
  ],
})
export class JobSearch {}

@Agent({
  name: "typo-agent",
  description: "Names an input field in its instructions",
  prompt: "Return at most {{input.limit}} jobs.",
  model: "test/typo",
  input: { search: SearchInDto },
  output: ShortlistDto,
})
export class Typo {}

/** Its agent's instructions name `{{input.limit}}`: instructions are static (#270 Q51). */
@Workflow({
  name: "typo-search-workflow",
  version: "1.0.0",
  defaults: { models: { maxTokens: 100, temperature: 0 }, history: { limit: 1 } },
  flow: [
    start(SearchStart).returns(SearchInDto).toAgent(Typo).returns(ShortlistDto).toFinish(Done),
  ],
})
export class TypoSearch {}

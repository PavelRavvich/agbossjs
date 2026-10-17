import { TerminalUserChannel } from "../../../src/channels/terminal-channel.js";
import { Agent, Tool, Workflow, WorkflowAction } from "../../../src/components/decorators.js";
import { Text, WorkflowFinishTextDto, WorkflowStartTextDto } from "../../../src/dto/index.js";
import {
  chain,
  Injectable,
  WorkflowFinish,
  WorkflowSettings,
  WorkflowStart,
  type ActionStartEvent,
  type AgentStartEvent,
  type AppState,
  type ChannelEndEvent,
  type ChannelStartEvent,
  type ExecutionOutput,
  type ModelStartEvent,
  type OnActionStart,
  type OnAgentStart,
  type OnChannelEnd,
  type OnChannelStart,
  type OnError,
  type OnModelStart,
  type OnRunRejected,
  type OnToolStart,
  type OnWorkflowEnd,
  type OnWorkflowPause,
  type OnWorkflowResume,
  type OnWorkflowStart,
  type ToolHandler,
  type RunRejectedEvent,
  type ToolStartEvent,
  type WorkflowDefinition,
  type WorkflowPauseEvent,
  type WorkflowResumeEvent,
} from "../../../src/index.js";

/** One observer event: the hook, the run and thread it carried, and what else the test checks. */
export interface SeenEvent {
  readonly hook: string;
  readonly runId: string;
  readonly threadId: string | undefined;
  readonly detail?: unknown;
}

/** Every event the observer saw, in order (reset with `resetEvents`). */
export const events: SeenEvent[] = [];

/** Every request the app refused before a run (`onRunRejected`), in order. */
export const rejections: RunRejectedEvent[] = [];

export function resetEvents(): void {
  events.length = 0;
  rejections.length = 0;
}

/** The workflow-level events only (`workflow-start`, `workflow-pause`, …, `error`). */
export const workflowEvents = (): SeenEvent[] =>
  events.filter((event) => event.hook.startsWith("workflow-") || event.hook === "error");

export class Query {
  @Text({ prompt: "what to look up" })
  text!: string;
}

/** A read tool. */
@Tool({ name: "lookup", description: "Looks jobs up", input: Query, output: Query })
export class Lookup implements ToolHandler<Query, Query> {
  run(input: Query): Promise<Query> {
    return Promise.resolve(input);
  }
}

/** A write tool with an approval channel: a run pauses before it. */
@Tool({
  name: "apply",
  description: "Applies for a job",
  channel: TerminalUserChannel,
  input: Query,
  output: Query,
})
export class Apply implements ToolHandler<Query, Query> {
  run(input: Query): Promise<Query> {
    return Promise.resolve(input);
  }
}

@Agent({
  name: "clerk",
  description: "Applies for jobs",
  prompt: "Apply for the jobs asked for.",
  tools: [Lookup, Apply],
  model: "test/clerk",
})
export class Clerk {}

@WorkflowAction({ name: "file", description: "Files the applications" })
export class FileAway {
  execute(): Record<string, never> {
    return {};
  }
}

/** Records every workflow-level event and the node events that name a thread. */
@Injectable()
export class RunLog
  implements
    OnWorkflowStart,
    OnWorkflowPause,
    OnWorkflowResume,
    OnWorkflowEnd,
    OnError,
    OnRunRejected,
    OnAgentStart,
    OnModelStart,
    OnToolStart,
    OnChannelStart,
    OnChannelEnd,
    OnActionStart
{
  private push(hook: string, state: AppState, detail?: unknown): void {
    events.push({ hook, runId: state.runId, threadId: state.threadId, detail });
  }
  onWorkflowStart(state: AppState): void {
    this.push("workflow-start", state);
  }
  onWorkflowPause(event: WorkflowPauseEvent): void {
    this.push("workflow-pause", event.state, event.pause);
  }
  onWorkflowResume(event: WorkflowResumeEvent): void {
    this.push("workflow-resume", event.state, event.decision);
  }
  onWorkflowEnd(result: ExecutionOutput, state: AppState): void {
    this.push("workflow-end", state, result.status);
  }
  onError(error: Error, state: AppState): void {
    this.push("error", state, error);
  }
  onRunRejected(event: RunRejectedEvent): void {
    rejections.push(event);
  }
  onAgentStart(event: AgentStartEvent): void {
    this.push("agent-start", event.state);
  }
  onModelStart(event: ModelStartEvent): void {
    this.push("model-start", event.state);
  }
  onToolStart(event: ToolStartEvent): void {
    this.push("tool-start", event.state);
  }
  onChannelStart(event: ChannelStartEvent): void {
    this.push("channel-start", event.state);
  }
  onChannelEnd(event: ChannelEndEvent): void {
    this.push("channel-end", event.state);
  }
  onActionStart(event: ActionStartEvent): void {
    this.push("action-start", event.state);
  }
}

@WorkflowStart({ name: "ask", description: "A request", input: WorkflowStartTextDto })
export class Ask {
  declare readonly input: WorkflowStartTextDto;
}

@WorkflowFinish({ name: "done", description: "The answer", output: WorkflowFinishTextDto })
export class Done {}

/** ask → clerk → file → done, observed by `RunLog`. */
@Workflow({
  name: "applications",
  version: "1.0.0",
  defaults: {
    models: { maxTokens: 100, temperature: 0 },
    history: { limit: 1 },
    tools: { maxToolCalls: 3 },
    router: { kind: "llm" as const, model: "test/router" },
  },
  providers: [FileAway],
  observers: [RunLog],
  channelClasses: [TerminalUserChannel],
  flow: [chain(Ask, Clerk, FileAway, Done)],
})
export class Applications implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder().build();
  }
}

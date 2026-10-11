import { A2AAgent, A2AClient } from "../../../src/a2a/index.js";
import {
  Agent,
  Injectable,
  Workflow,
  chain,
  WorkflowFinish,
  WorkflowSettings,
  WorkflowStart,
  type WorkflowDefinition,
  Tool,
  type ToolHandler,
} from "../../../src/index.js";
import { Text, WorkflowFinishText, WorkflowStartText } from "../../../src/dto/index.js";
import type { Class } from "../../../src/components/injection.js";
import type { WorkflowStartClass } from "../../../src/graph/workflow-start.decorator.js";
import type { ToolClass } from "../../../src/testing/index.js";

export class Question {
  @Text({ prompt: "the question for the order desk" })
  question!: string;
}

/** What the caller expects back: the remote finish output (`{ text }`). */
export class DeskReply {
  @Text()
  text!: string;
}

/** An output the remote desk never gives (no `ticket`): validation must reject it. */
export class TicketedReply {
  @Text()
  text!: string;

  @Text()
  ticket!: string;
}

/** A service the client depends on: the token it sends to the remote desk. */
@Injectable()
export class DeskCredentials {
  token(): string {
    return "secret-42";
  }
}

/** The caller workflow, bound to a remote desk at `url` (known once the server listens). */
export interface CallerParts {
  readonly Caller: Class;
  readonly PlanStart: WorkflowStartClass;
  readonly AskDesk: ToolClass<Question>;
  readonly AskTicket: ToolClass<Question>;
  readonly RemoteDeskAgent: Class<A2AClient>;
}

export function callerOf(url: string): CallerParts {
  @A2AAgent({ name: "remote-desk", url, deps: [DeskCredentials] })
  class RemoteDeskAgent extends A2AClient {
    constructor(private readonly credentials: DeskCredentials) {
      super();
    }

    protected override getHeaders(): Promise<Record<string, string>> {
      return Promise.resolve({ authorization: `Bearer ${this.credentials.token()}` });
    }
  }

  @Tool({
    name: "ask_desk",
    description: "Asks the remote order desk",
    input: Question,
    output: DeskReply,
    deps: [RemoteDeskAgent],
  })
  class AskDesk implements ToolHandler<Question, DeskReply> {
    constructor(private readonly desk: RemoteDeskAgent) {}

    run({ question }: Question): Promise<DeskReply> {
      return this.desk.execute({ text: question }, DeskReply);
    }
  }

  @Tool({
    name: "ask_desk_ticket",
    description: "Asks the remote order desk for a ticket",
    input: Question,
    output: TicketedReply,
    deps: [RemoteDeskAgent],
  })
  class AskTicket implements ToolHandler<Question, TicketedReply> {
    constructor(private readonly desk: RemoteDeskAgent) {}

    run({ question }: Question): Promise<TicketedReply> {
      return this.desk.execute({ text: question }, TicketedReply);
    }
  }

  @Agent({
    name: "planner",
    description: "Plans with the remote desk",
    model: "test/planner",
    tools: [AskDesk, AskTicket],
  })
  class Planner {}

  @WorkflowStart({ name: "plan", description: "A request", input: WorkflowStartText })
  class PlanStart {
    declare readonly input: WorkflowStartText;
  }

  @WorkflowFinish({ name: "done", description: "The plan", output: WorkflowFinishText })
  class PlanDone {}

  @Workflow({
    name: "caller",
    version: "1.0.0",
    flow: [chain(PlanStart, Planner, PlanDone)],
    providers: [DeskCredentials, RemoteDeskAgent],
    defaults: {
      models: { temperature: 0, thinking: "default", cache: true },
      router: { kind: "jev", model: "typesafe/jev-1.13" },
      tools: { maxToolCalls: 2 },
      history: { limit: 2 },
    },
  })
  class Caller implements WorkflowDefinition {
    settings(): WorkflowSettings {
      return WorkflowSettings.builder().build();
    }
  }

  return { Caller, PlanStart, AskDesk, AskTicket, RemoteDeskAgent };
}

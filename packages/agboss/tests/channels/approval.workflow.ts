import {
  Agent,
  Channel,
  InboundChannelAdapter,
  Injectable,
  InjectionToken,
  Workflow,
  type ChannelDecision,
  type ChannelHandler,
  type ChannelRequest,
  from,
  WorkflowFinish,
  WorkflowSettings,
  WorkflowStart,
  type WorkflowDefinition,
  Tool,
  type ToolHandler,
} from "../../src/index.js";
import { Text, WorkflowFinishText, WorkflowStartText } from "../../src/dto/index.js";

/** What the channel posted and what the tool did — the observable effects the tests read. */
@Injectable()
export class ApprovalDesk {
  readonly posted: ChannelRequest[] = [];
  readonly refunded: string[] = [];
}

/** A reply as a chat app delivers it (a button click), not as the framework's decision. */
export interface ButtonClick {
  readonly action: "approve" | "reject";
  readonly user: string;
  readonly reason?: string;
}

@InboundChannelAdapter({ name: "button-click" })
export class ButtonClickAdapter implements InboundChannelAdapter<ButtonClick> {
  interpret(click: ButtonClick): Promise<ChannelDecision & { by: string }> {
    return Promise.resolve(
      click.action === "approve"
        ? { approved: true, by: click.user }
        : { approved: false, by: click.user, feedback: click.reason ?? "rejected" },
    );
  }
}

/** A chat-app channel: posts the ask somewhere (here: the desk it depends on). */
@Channel({ name: "chat-app", inboundAdapter: ButtonClickAdapter, deps: [ApprovalDesk] })
export class ChatAppChannel implements ChannelHandler {
  constructor(private readonly desk: ApprovalDesk) {}

  requestApproval = (req: ChannelRequest): Promise<void> => {
    this.desk.posted.push(req);
    return Promise.resolve();
  };
}

class RefundRequest {
  @Text({ prompt: "the order id" })
  orderId!: string;
}

class RefundDone {
  @Text()
  status!: string;
}

@Tool({
  name: "refund",
  description: "Refunds an order",
  input: RefundRequest,
  output: RefundDone,
  channel: ChatAppChannel,
  deps: [ApprovalDesk],
})
export class Refund implements ToolHandler<RefundRequest, RefundDone> {
  constructor(private readonly desk: ApprovalDesk) {}

  run({ orderId }: RefundRequest): Promise<RefundDone> {
    this.desk.refunded.push(orderId);
    return Promise.resolve({ status: `refunded ${orderId}` });
  }
}

@Agent({
  name: "clerk",
  promptUrls: ["./clerk.prompt.md"],
  description: "Refunds orders",
  model: "test/clerk",
  price: { inputPerMTok: 1, outputPerMTok: 10 },
  tools: [Refund],
})
export class Clerk {}

@WorkflowStart({ name: "chat", description: "A message", input: WorkflowStartText })
export class ChatStart {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "reply", description: "The reply", output: WorkflowFinishText })
export class Reply {}

const defaults = {
  models: { temperature: 0, thinking: "default", cache: true },
  router: { kind: "jev", model: "typesafe/jev-1.13" },
  tools: { maxToolCalls: 2 },
  history: { limit: 2 },
} as const;

class NoLimits implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder().build();
  }
}

/** One agent whose refund tool waits for an approval through the chat-app channel. */
@Workflow({
  name: "refunds",
  version: "1.0.0",
  flow: [from(ChatStart).next(Clerk), from(Clerk).next(Reply)],
  defaults,
  channelClasses: [ChatAppChannel],
  providers: [ApprovalDesk],
})
export class Refunds extends NoLimits {}

export const AUDIT_LOG = new InjectionToken<string[]>("AUDIT_LOG");

/** A channel whose dependency nobody provides. */
@Channel({ name: "audited", deps: [AUDIT_LOG] })
export class AuditedChannel implements ChannelHandler {
  constructor(private readonly log: string[]) {}

  requestApproval = (req: ChannelRequest): Promise<void> => {
    this.log.push(req.toolName);
    return Promise.resolve();
  };
}

@Workflow({
  name: "audited-refunds",
  version: "1.0.0",
  flow: [from(ChatStart).next(Clerk), from(Clerk).next(Reply)],
  defaults,
  channelClasses: [ChatAppChannel, AuditedChannel],
  providers: [ApprovalDesk],
})
export class AuditedRefunds extends NoLimits {}

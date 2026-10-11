import {
  Agent,
  Injectable,
  Workflow,
  chain,
  from,
  WorkflowSettings,
  type WorkflowDefinition,
  Tool,
  type ToolContext,
  type ToolHandler,
} from "../../src/index.js";
import { Text } from "../../src/dto/index.js";
import { usd } from "../../src/units/index.js";
import { ApprovalDesk, ChatAppChannel, ChatStart, Reply } from "../channels/approval.workflow.js";

/** What the payment tool got: the owner of each call (`ctx.run.owner`) and the cards charged. */
@Injectable()
export class PaymentLog {
  readonly owners: (string | undefined)[] = [];
  readonly cards: string[] = [];
}

class PayRequest {
  @Text({ prompt: "the order id" })
  orderId!: string;

  @Text({ prompt: "the card number", sensitive: true })
  cardNumber!: string;
}

class PayDone {
  @Text()
  status!: string;
}

/** Charges a card — waits for an approval through the chat-app channel first. */
@Tool({
  name: "pay",
  description: "Charges a card for an order",
  input: PayRequest,
  output: PayDone,
  channel: ChatAppChannel,
  deps: [PaymentLog],
})
export class Pay implements ToolHandler<PayRequest, PayDone> {
  constructor(private readonly log: PaymentLog) {}

  run({ orderId, cardNumber }: PayRequest, ctx: ToolContext): Promise<PayDone> {
    this.log.owners.push(ctx.run.owner);
    this.log.cards.push(cardNumber);
    return Promise.resolve({ status: `paid ${orderId}` });
  }
}

const price = { inputPerMTok: 1, outputPerMTok: 10 };

@Agent({
  name: "cashier",
  promptUrls: ["./cashier.prompt.md"],
  description: "Takes payments",
  model: "test/cashier",
  price,
  tools: [Pay],
})
export class Cashier {}

const defaults = {
  models: { temperature: 0, thinking: "default", cache: true },
  router: { kind: "jev", model: "typesafe/jev-1.13" },
  tools: { maxToolCalls: 2 },
  history: { limit: 2 },
} as const;

/** One agent whose card payment waits for an approval: threads, pauses and channel output. */
@Workflow({
  name: "payments",
  version: "1.0.0",
  flow: [from(ChatStart).next(Cashier), from(Cashier).next(Reply)],
  defaults,
  channelClasses: [ChatAppChannel],
  providers: [ApprovalDesk, PaymentLog],
})
export class Payments implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder().build();
  }
}

@Agent({
  name: "drafter",
  promptUrls: ["./cashier.prompt.md"],
  description: "Drafts",
  model: "test/drafter",
  price,
})
export class Drafter {}

@Agent({
  name: "editor",
  promptUrls: ["./cashier.prompt.md"],
  description: "Edits",
  model: "test/editor",
  price,
})
export class Editor {}

/** Two paid steps per run under a run cap of $0.40 and a daily cap of $1.00. */
@Workflow({
  name: "capped",
  version: "1.0.0",
  flow: [chain(ChatStart, Drafter, Editor, Reply)],
  defaults,
})
export class Capped implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder()
      .limits({ perRun: { cost: usd(0.4) }, perDay: { cost: usd(1) } })
      .build();
  }
}

/** A daily cap with no run cap: refused at start (#202). */
@Workflow({
  name: "day-cap-only",
  version: "1.0.0",
  flow: [chain(ChatStart, Drafter, Editor, Reply)],
  defaults,
})
export class DayCapOnly implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder()
      .limits({ perDay: { cost: usd(1) } })
      .build();
  }
}

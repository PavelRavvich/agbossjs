import {
  Agent,
  Workflow,
  MODEL_MAX,
  Tool,
  type ToolHandler,
  catchError,
  from,
  WorkflowFinish,
  WorkflowSettings,
  WorkflowStart,
  type WorkflowDefinition,
  BudgetExceededError,
  LimitExceededError,
} from "../../src/index.js";
import { TerminalUserChannel } from "../../src/channels/terminal-channel.js";
import { Text, WorkflowFinishText, WorkflowStartText } from "../../src/dto/index.js";
import { usd } from "../../src/units/index.js";

export class Payment {
  @Text() item!: string;
}

export class Receipt {
  @Text() id!: string;
}

/** A tool that needs a person's approval: the run pauses before it runs. */
@Tool({
  name: "pay",
  description: "Pays for an item",
  input: Payment,
  output: Receipt,
  channel: TerminalUserChannel,
})
export class Pay implements ToolHandler<Payment, Receipt> {
  run({ item }: Payment): Promise<Receipt> {
    return Promise.resolve({ id: `receipt-${item}` });
  }
}

const price = { inputPerMTok: 1, outputPerMTok: 10 };
const defaults = {
  models: { temperature: 0, maxTokens: MODEL_MAX, thinking: "default", cache: true },
  router: { kind: "jev", model: "typesafe/jev-1.13" },
  tools: { maxToolCalls: 4 },
  history: { limit: 4 },
} as const;

@Agent({
  name: "buyer",
  prompt: "Buy what is asked.",
  description: "Buys things",
  model: "test/buyer",
  price,
  tools: [Pay],
})
export class Buyer {}

@Agent({
  name: "checker",
  prompt: "Check the purchase.",
  description: "Checks purchases",
  model: "test/checker",
  price,
})
export class Checker {}

@WorkflowStart({ name: "order", description: "An order", input: WorkflowStartText })
export class Order {
  declare readonly input: WorkflowStartText;
}

@WorkflowFinish({ name: "done", description: "Bought and checked", output: WorkflowFinishText })
export class Done {}

@WorkflowFinish({ name: "over-budget", description: "Out of money", output: WorkflowFinishText })
export class OverBudget {}

/** A run budget of $0.01: a buyer that spends more leaves nothing for the checker. */
const settings = (): WorkflowSettings =>
  WorkflowSettings.builder()
    .limits({ perRun: { cost: usd(0.01) } })
    .build();

@Workflow({
  name: "shop",
  version: "1.0.0",
  flow: [
    from(Order).next(Buyer),
    from(Buyer).next(Checker),
    from(Checker).next(Done),
    catchError(Checker, BudgetExceededError).next(OverBudget),
  ],
  defaults,
  channelClasses: [TerminalUserChannel],
})
export class Shop implements WorkflowDefinition {
  settings = settings;
}

/** The same shop, catching the parent class: a budget error is a limit error. */
@Workflow({
  name: "shop-limits",
  version: "1.0.0",
  flow: [
    from(Order).next(Buyer),
    from(Buyer).next(Checker),
    from(Checker).next(Done),
    catchError(Checker, LimitExceededError).next(OverBudget),
  ],
  defaults,
  channelClasses: [TerminalUserChannel],
})
export class ShopCatchingLimits implements WorkflowDefinition {
  settings = settings;
}

/** No catch: the budget error fails the run, typed. */
@Workflow({
  name: "shop-uncaught",
  version: "1.0.0",
  flow: [from(Order).next(Buyer), from(Buyer).next(Checker), from(Checker).next(Done)],
  defaults,
  channelClasses: [TerminalUserChannel],
})
export class ShopUncaught implements WorkflowDefinition {
  settings = settings;
}

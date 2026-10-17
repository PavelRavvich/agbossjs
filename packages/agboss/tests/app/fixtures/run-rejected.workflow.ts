import { TerminalUserChannel } from "../../../src/channels/terminal-channel.js";
import { Workflow } from "../../../src/components/decorators.js";
import { Text, WorkflowStartTextDto } from "../../../src/dto/index.js";
import { crossFieldRule } from "../../../src/dto/schema.js";
import {
  chain,
  WorkflowSettings,
  WorkflowStart,
  type WorkflowDefinition,
} from "../../../src/index.js";
import { usd } from "../../../src/units/index.js";
import { Clerk, Done, RunLog } from "./run-events.workflow.js";

/** A start input with a code a rule checks; the rule's reason echoes the value it rejects. */
export class Voucher extends WorkflowStartTextDto {
  @Text({ prompt: "the voucher code" })
  code!: string;
}

crossFieldRule(Voucher, (voucher) =>
  voucher.code.startsWith("V-")
    ? undefined
    : { field: "code", reason: `"${voucher.code}" is not a voucher code` },
);

@WorkflowStart({ name: "redeem", description: "Redeems a voucher", input: Voucher })
export class Redeem {
  declare readonly input: Voucher;
}

/** redeem → clerk → done, observed by `RunLog` (its `rejections` too); $0.05 a day. */
@Workflow({
  name: "vouchers",
  version: "1.0.0",
  defaults: {
    models: { maxTokens: 100, temperature: 0 },
    history: { limit: 1 },
    tools: { maxToolCalls: 3 },
    router: { kind: "llm" as const, model: "test/router" },
  },
  observers: [RunLog],
  channelClasses: [TerminalUserChannel],
  flow: [chain(Redeem, Clerk, Done)],
})
export class Vouchers implements WorkflowDefinition {
  settings(): WorkflowSettings {
    return WorkflowSettings.builder()
      .limits({ perRun: { steps: 12, cost: usd(0.05) }, perDay: { cost: usd(0.05) } })
      .build();
  }
}

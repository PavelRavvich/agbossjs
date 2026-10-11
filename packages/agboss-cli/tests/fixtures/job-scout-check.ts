/**
 * A hand-written test dropped into the job-scout copy after the generators ran (#197): the generated
 * agent is a real stop of the star, and the generated tool is a real tool of that agent.
 */
export const JOB_SCOUT_CHECK = `import { callTool, replyWith, routeTo, testWith } from "agboss/testing";
import { expect } from "vitest";
import { BillingAgent } from "../src/agents/billing.agent.js";
import { JobScout } from "../src/job-scout.workflow.js";
import { MainRouter } from "../src/routers/main.router.js";
import { RefundTool } from "../src/tools/refund.tool.js";
import { ChatWorkflowFinish } from "../src/workflow-finishes/chat.workflow-finish.js";
import { ChatWorkflowStart } from "../src/workflow-starts/chat.workflow-start.js";

const test = testWith(JobScout);

test("the generated agent joins the star and calls its generated tool", async ({
  app,
  mockLlm,
}) => {
  mockLlm(MainRouter).thenReturn(routeTo(BillingAgent), routeTo(ChatWorkflowFinish));
  mockLlm(BillingAgent).thenReturn(
    callTool(RefundTool, { query: "order 42" }),
    replyWith("Refunded."),
  );

  const result = await app.execute(ChatWorkflowStart, { text: "refund order 42" });

  expect(result).toFollowPath([
    ChatWorkflowStart,
    MainRouter,
    BillingAgent,
    MainRouter,
    ChatWorkflowFinish,
  ]);
  expect(result).toFinishWith(ChatWorkflowFinish, { text: "Refunded." });
});
`;

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScaffoldError } from "../../src/scaffold/errors.js";
import { FINISH_ROUTE_TEXT, MAIN_ROUTER } from "../../src/scaffold/flow-files.js";
import { planGenerate } from "../../src/scaffold/generate.js";
import { addAgentToFlow } from "../../src/scaffold/wire-flow.js";

const workflow = (flow: string) => ({ path: "src/desk/desk.workflow.ts", content: flow });

describe("#116: agboss g agent joins the star; agboss g router", () => {
  it("#200: adds the agent to the agents going back to the router; routes() stays empty", () => {
    const file = workflow(
      "flow: [\n  from(TextWorkflowStart).next(MainRouter),\n  from(MainRouter).routes(),\n  from(TriageAgent).next(MainRouter),\n]",
    );

    expect(addAgentToFlow(file, "BillingAgent", "MainRouter", ["TriageAgent"]).content).toBe(
      "flow: [\n  from(TextWorkflowStart).next(MainRouter),\n  from(MainRouter).routes(),\n  from(TriageAgent, BillingAgent).next(MainRouter),\n]",
    );
  });

  it("an unexpected flow is not guessed: an error naming the file", () => {
    const file = workflow(
      "[from(TextWorkflowStart).next(TriageAgent), from(TriageAgent).next(TextWorkflowFinish)]",
    );

    expect(() => addAgentToFlow(file, "BillingAgent", "MainRouter", ["TriageAgent"])).toThrow(
      ScaffoldError,
    );
    expect(() => addAgentToFlow(file, "BillingAgent", "MainRouter", ["TriageAgent"])).toThrow(
      "src/desk/desk.workflow.ts: no from(MainRouter).routes() and from(<agents>).next(MainRouter)",
    );
  });

  it("adding an agent that is already in the star doubles nothing: it is reported as skipped", () => {
    const file = workflow(
      "[from(MainRouter).routes(), from(TriageAgent, BillingAgent).next(MainRouter)]",
    );

    const again = addAgentToFlow(file, "BillingAgent", "MainRouter", [
      "TriageAgent",
      "BillingAgent",
    ]);

    expect(again.content).toBe(file.content);
    expect(again.skipped).toEqual([
      "src/desk/desk.workflow.ts: BillingAgent already in from(…).next(MainRouter)",
    ]);
  });

  it("agboss g router routes to the finish the workflow imports, whatever its file is called", async () => {
    const root = mkdtempSync(join(tmpdir(), "agboss-router-"));
    mkdirSync(join(root, "src/desk/ends"), { recursive: true });
    writeFileSync(join(root, "src/desk/desk.workflow.ts"), "");
    const options = { workflow: "src/desk/desk.workflow.ts" };

    await expect(planGenerate("router", "escalation", options, root)).rejects.toThrow(
      "src/desk/desk.workflow.ts: imports no @WorkflowFinish class",
    );
    writeFileSync(
      join(root, "src/desk/desk.workflow.ts"),
      'import { DoneFinish } from "./ends/done.ts";\n',
    );
    writeFileSync(
      join(root, "src/desk/ends/done.ts"),
      '@WorkflowFinish({ name: "done", output: X })\nexport class DoneFinish {}\n',
    );
    const [router] = (await planGenerate("router", "escalation", options, root)).create;
    expect(router?.path).toBe("src/desk/routers/escalation.router.ts");
    expect(router?.content).toContain("export class EscalationRouter {}");
    expect(router?.content).toContain('import { DoneFinish } from "../ends/done.js";');
    expect(router?.content).toContain(
      '{ prompt: "Stop and send the answer: the contributions so far answer the message',
    );
    // #142 AC3: a new router is bounded on any cycle it is later put on
    expect(router?.content).toContain("  maxVisits: 1,\n");
  });
});

describe("#197: the router prompts every scaffold writes", () => {
  it("the finish route is the stop instruction CLAUDE.md prescribes, pinned word for word", () => {
    const guide = readFileSync(new URL("../../../../CLAUDE.md", import.meta.url), "utf8");
    const [, prefix] = /\("(Stop and send the answer:) …"\)/.exec(guide) ?? [];

    expect(prefix).toBe("Stop and send the answer:");
    expect(FINISH_ROUTE_TEXT.startsWith(`${prefix ?? "?"} `)).toBe(true);
    expect(FINISH_ROUTE_TEXT).toBe(
      "Stop and send the answer: the contributions so far answer the message, or the last agent asked a question and waits for the reply, or it cannot be done",
    );
    expect(MAIN_ROUTER).toEqual({
      description: "Sends the message to the right agent, or sends the answer",
      prompt:
        "Pick who handles the message next. Send the answer when the contributions so far already cover the message.",
      maxVisits: 3,
    });
  });
});

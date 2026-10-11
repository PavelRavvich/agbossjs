import { FakeListChatModel } from "@langchain/core/utils/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DtoValidationError } from "../src/dto/index.js";
import { NotPausedError, resumeAgent, runAgent, type RunDeps } from "../src/index.js";
import { createModelRegistry } from "../src/llm/registry.js";

import { defineTool } from "../src/tools/index.js";
import { ScriptedChatModel, type Reply } from "./fakes/scripted-model.js";
import {
  routeTo,
  fakeDeps,
  memoryLedger,
  testConfig,
  type TestAgent,
  libraryTool,
  fakeGateway,
} from "./helpers.js";

const sendEmail = (sent: string[]) =>
  defineTool({
    name: "send_email",
    description: "Send an email",
    channel: "terminal",
    input: z.object({ to: z.string() }),
    output: z.string(),
    run: ({ to }) => {
      sent.push(to);
      return Promise.resolve(`sent to ${to}`);
    },
  });

const callSend: Reply = [{ tool: "send_email", args: { to: "boss@example.com" } }];

function setup(alphaReplies: readonly Reply[], withSeam = true) {
  const sent: string[] = [];
  const alpha = new ScriptedChatModel(alphaReplies);
  const ledger = memoryLedger();
  const config = {
    ...testConfig,
    agents: { ...testConfig.agents, alpha: { ...testConfig.agents.alpha, tools: ["send_email"] } },
  };
  const base = fakeDeps(
    { "test/router": [routeTo("alpha"), routeTo("replyWith", "done")] },
    ledger,
  );
  const deps: RunDeps<TestAgent> = {
    ...base,
    config,
    registry: createModelRegistry(
      config,
      fakeGateway((settings) =>
        settings.model === "test/alpha" ? alpha : new FakeListChatModel({ responses: ["x"] }),
      ),
    ),
    tools: (name) => (name === "send_email" ? sendEmail(sent) : libraryTool(name)),
    ...(withSeam ? { pause: { checkpointer: new MemorySaver() } } : {}),
  };
  return { deps, sent, alpha, ledger };
}

describe("pause seam", () => {
  it("without a seam, write tools run as before", async () => {
    const { deps, sent } = setup([callSend, "Sent."], false);

    const result = await runAgent({ task: "Email the boss" }, deps);

    expect(result.status).toBe("answered");
    expect(sent).toEqual(["boss@example.com"]);
  });

  it("pauses before a write tool, with the pending call and nothing executed", async () => {
    const { deps, sent, alpha } = setup([callSend, "Sent."]);

    const paused = await runAgent({ task: "Email the boss" }, deps);

    expect(paused).toMatchObject({
      status: "paused",
      pending: { agent: "alpha", tool: "send_email", args: { to: "boss@example.com" } },
    });
    expect(sent).toEqual([]);
    expect(alpha.sent).toHaveLength(1);
    expect((await deps.terns.byIds([paused.ternId]))[0]?.status).toBe("paused");
  });

  it("resumes after approval: the tool runs once, same run and Tern", async () => {
    const { deps, sent } = setup([callSend, "Sent it to your boss."]);
    const paused = await runAgent({ task: "Email the boss" }, deps);

    const done = await resumeAgent(paused, { approved: true, by: "tester" }, deps);

    expect(done).toMatchObject({
      status: "answered",
      replyWith: "Sent it to your boss.",
      runId: paused.runId,
      ternId: paused.ternId,
    });
    expect(sent).toEqual(["boss@example.com"]);
    expect((await deps.terns.byIds([paused.ternId]))[0]?.status).toBe("answered");
  });

  it("#141 AC5, #148 AC2: resumes with { approved, by, reason }; who rejected and why reach the agent", async () => {
    const { deps, sent, alpha } = setup([callSend, "Understood, not sending."]);
    const paused = await runAgent({ task: "Email the boss" }, deps);

    const done = await resumeAgent(
      paused,
      { approved: false, by: "tester", feedback: "not now" },
      deps,
    );

    expect(done.replyWith).toBe("Understood, not sending.");
    expect(sent).toEqual([]);
    expect(alpha.sent[1]?.at(-1)?.text).toBe(
      "Tool error: the call was rejected by tester: not now",
    );
  });

  it("#150 AC6: the turn that asked for the call is not asked again; the model continues after the decision", async () => {
    const { deps, sent, alpha } = setup([callSend, "Sent."]);
    const paused = await runAgent({ task: "Email the boss" }, deps);

    const done = await resumeAgent(paused, { approved: true, by: "tester" }, deps);

    expect(done).toMatchObject({ status: "answered", replyWith: "Sent." });
    expect(sent).toEqual(["boss@example.com"]);
    expect(alpha.sent).toHaveLength(2);
    expect(alpha.sent[1]?.at(-1)?.text).toBe("sent to boss@example.com");
  });

  it("#148 AC2: reports a rejection without a reason plainly, naming who rejected", async () => {
    const { deps, alpha } = setup([callSend, "Ok."]);
    const paused = await runAgent({ task: "Email the boss" }, deps);

    await resumeAgent(paused, { approved: false, by: "tester" }, deps);

    expect(alpha.sent[1]?.at(-1)?.text).toBe("Tool error: the call was rejected by tester");
  });

  it("keeps FinOps consistent: no spend recorded twice across pause and resume", async () => {
    const { deps, ledger } = setup([callSend, "Done."]);
    const paused = await runAgent({ task: "Email the boss" }, deps);

    const done = await resumeAgent(paused, { approved: true, by: "tester" }, deps);

    expect(ledger.recorded).toHaveLength(done.cost.calls);
    expect(done.budgetUsd).toBe(paused.budgetUsd);
  });

  it("refuses to resume twice or to resume a finished run", async () => {
    const { deps } = setup([callSend, "Done."]);
    const paused = await runAgent({ task: "Email the boss" }, deps);
    const done = await resumeAgent(paused, { approved: true, by: "tester" }, deps);

    await expect(
      resumeAgent(paused, { approved: true, by: "tester" }, deps),
    ).rejects.toBeInstanceOf(NotPausedError);
    await expect(resumeAgent(done, { approved: true, by: "tester" }, deps)).rejects.toBeInstanceOf(
      NotPausedError,
    );
  });

  it("records a failure after resume on the same Tern", async () => {
    const { deps: base } = setup([callSend]);
    const paused = await runAgent({ task: "Email the boss" }, base);
    const deps = {
      ...base,
      routerFor: () => ({ name: "main", route: () => Promise.reject(new Error("router down")) }),
    };

    await expect(resumeAgent(paused, { approved: true, by: "tester" }, deps)).rejects.toThrow();

    expect((await deps.terns.byIds([paused.ternId]))[0]).toMatchObject({ status: "failed" });
  });
});

describe("resume decisions", () => {
  it("#141 AC5: a decision without `by` (the old { approve } shape) is refused", async () => {
    const { deps, sent } = setup([callSend, "Sent."]);
    const paused = await runAgent({ task: "Email the boss" }, deps);
    const old: unknown = { approve: true };

    await expect(resumeAgent(paused, old, deps)).rejects.toBeInstanceOf(DtoValidationError);
    expect(sent).toEqual([]);
  });
});

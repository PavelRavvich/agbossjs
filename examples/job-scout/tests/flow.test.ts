import { describe, expect, it } from "vitest";
import { workflowOf } from "agboss/testing";
import { describeWorkflow } from "agboss";
import { replyWith, callTool, routeTo, testWith } from "agboss/testing";
import { JobScout } from "../src/job-scout.workflow.js";
import { MainRouter } from "../src/routers/main.router.js";
import { Profiler } from "../src/agents/profiler.agent.js";
import { Shortlist } from "../src/agents/shortlist.agent.js";
import { SaveShortlist } from "../src/mcp/save-shortlist.mcp.js";
import { ShortlistServer } from "../src/mcp/shortlist.server.js";
import { ChatWorkflowStart } from "../src/workflow-starts/chat.workflow-start.js";
import { ChatWorkflowFinish } from "../src/workflow-finishes/chat.workflow-finish.js";

const workflow = await workflowOf(JobScout);

describe("job-scout on the flow graph (#116)", () => {
  it("AC1: the flow assembles as a star — workflow start → main router ⇄ agents → workflow finish", () => {
    const lines = describeWorkflow(workflow);

    expect(lines).toEqual(
      expect.arrayContaining([
        "flow",
        "  chat (workflow start) → main",
        "  main → profiler | scout | shortlist | chat (workflow finish)",
        "  profiler, scout, shortlist → main",
      ]),
    );
    expect(Object.keys(workflow.config.agents)).toEqual(["profiler", "scout", "shortlist"]);
  });

  it("AC1: the main router is Jev, at most 3 visits a run, its routes sorted by name", () => {
    const [main] = workflow.routers;

    expect(workflow.routers).toHaveLength(1);
    expect(main).toMatchObject({ name: "main", model: "typesafe/jev-1.13", maxVisits: 3 });
    expect(main?.routes.map((item) => item.option)).toEqual([
      "chat",
      "profiler",
      "scout",
      "shortlist",
    ]);
    expect(describeWorkflow(workflow)).toContain(
      "  main  decisions typesafe/jev-1.13 · maxVisits 3 — Sends the job seeker's message to the right agent, or sends the answer",
    );
  });

  it("AC1: limits come from settings() — 12 steps and $0.10 a run, $1 a day", () => {
    expect(workflow.limits).toEqual({ perRun: { steps: 12, cost: 0.1 }, perDay: { cost: 1 } });
    expect(describeWorkflow(workflow)).toContain("limits    run 12 steps · $0.1 · day $1");
  });

  it("AC1: guards, the approval pause and compaction stay on", () => {
    expect(workflow.config.guards?.input).toHaveProperty("prompt_injection");
    expect(workflow.config.guards?.output).toHaveProperty("pii");
    expect(workflow.config.compaction).toMatchObject({ every: 5, keep: 10 });
  });
});

const test = testWith(JobScout);
const job = {
  title: "Backend Engineer",
  company: "Fireblocks",
  location: "Tel Aviv",
  link: "https://example.com/1",
  fit: 81,
};

describe("job-scout by script (#135): the star, the approval pause and resume, #100", () => {
  test("AC12: the star — the main router sends the message to an agent and the replyWith back", async ({
    app,
    mockLlm,
  }) => {
    mockLlm(MainRouter).thenReturn(routeTo(Profiler), routeTo(ChatWorkflowFinish));
    mockLlm(Profiler).thenReturn(replyWith("Brief: senior backend, Israel"));

    const result = await app.execute(ChatWorkflowStart, { text: "propose a search brief" });

    expect(result).toFollowPath([
      ChatWorkflowStart,
      MainRouter,
      Profiler,
      MainRouter,
      ChatWorkflowFinish,
    ]);
    expect(result).toFinishWith(ChatWorkflowFinish, { text: "Brief: senior backend, Israel" });
    expect(mockLlm(MainRouter)).toHaveBeenAskedWith({ input: "propose a search brief" });
  });

  test("AC12: saving to the shortlist waits for approval; after it the turn ends without asking the router (#100)", async ({
    app,
    mockLlm,
    mcpOf,
  }) => {
    mockLlm(MainRouter).thenReturn(routeTo(Shortlist));
    mockLlm(Shortlist).thenReturn(
      callTool(SaveShortlist, { jobs: [job] }),
      replyWith("Saved 1 job."),
    );
    const written: string[] = [];
    mcpOf(ShortlistServer).thenReturn({
      read_text_file: () => Promise.reject(new Error("ENOENT: no such file")),
      write_file: ({ content }: { content: string }) => {
        written.push(content);
        return Promise.resolve({ content: "ok" });
      },
    });

    const paused = await app.execute(ChatWorkflowStart, { text: "save the first job" });
    const done = await app.resume(paused.thread, { approved: true, by: "dana" });

    expect(paused).toHavePausedAt(Shortlist);
    expect(done).toFinishWith(ChatWorkflowFinish, { text: "Saved 1 job." });
    expect(done.stopReason).toBe("the agent answered after the approval decision");
    expect(mockLlm(MainRouter).requests).toHaveLength(1);
    expect(mockLlm(Shortlist)).toHaveCalledTools([SaveShortlist]);
    expect(written).toEqual([
      "# Shortlist\n- [Backend Engineer — Fireblocks, Tel Aviv](https://example.com/1) · fit 81%\n",
    ]);
  });

  test("AC12: a declined save is not written; the agent replyWiths after the decision", async ({
    app,
    mockLlm,
    mcpOf,
  }) => {
    mockLlm(MainRouter).thenReturn(routeTo(Shortlist));
    mockLlm(Shortlist).thenReturn(
      callTool(SaveShortlist, { jobs: [job] }),
      replyWith("Not saved."),
    );
    const shortlist = mcpOf(ShortlistServer);

    const paused = await app.execute(ChatWorkflowStart, { text: "save the first job" });
    const done = await app.resume(paused.thread, { approved: false, by: "dana", reason: "no" });

    expect(done).toFinishWith(ChatWorkflowFinish, { text: "Not saved." });
    expect(shortlist.calls).toEqual([]);
  });
});

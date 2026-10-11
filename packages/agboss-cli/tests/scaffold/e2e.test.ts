/**
 * #93 AC1 / AC2: a generated project compiles, passes its own tests and the framework's lint rules, and
 * its workflow assembles — right after `create` and after each `generate`. Generated inside the monorepo
 * (its installed dependencies); a real `npm install` is the manual check M1.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { specFromFlags } from "../../src/scaffold/flags.js";
import { FINISH_ROUTE_TEXT } from "../../src/scaffold/flow-files.js";
import { planGenerate } from "../../src/scaffold/generate.js";
import type { WorkflowSpec } from "../../src/scaffold/plan.js";
import { planProject } from "../../src/scaffold/project.js";
import { applyChanges } from "../../src/scaffold/write.js";
import { expectStaticChecks, agbossIn, vitestOf } from "./project-checks.js";

const tmp = new URL("../../.scaffold-tmp", import.meta.url).pathname;
const project = join(tmp, `desk-${String(process.pid)}`);

/** tsc, the framework's ESLint rules, prettier, the project's own tests, `agboss describe` on its workflow. */
function check(workflow: string): string {
  expectStaticChecks(project, ["src"]);
  const tests = vitestOf(project);
  expect(tests.ok, tests.out).toBe(true);
  const describeOut = agbossIn(project, ["describe", "--workflow", workflow]);
  expect(describeOut.ok, describeOut.out).toBe(true);
  return describeOut.out;
}

const scripts = (): Record<string, string> =>
  (
    JSON.parse(readFileSync(join(project, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts;

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
});

describe("agboss create / agboss generate end to end", () => {
  it("AC1: create → a project that compiles, passes its tests and lint, and whose workflow assembles", async () => {
    mkdirSync(tmp, { recursive: true });
    const spec = specFromFlags("desk", {
      yes: true,
      agents: "triage:Sorts requests,answerer:Answers questions",
      tools: "answerer:search_orders",
      mcp: `filesystem:${tmp}`,
      rag: "notes",
    }) as WorkflowSpec;
    await applyChanges(project, { create: planProject(spec), modify: [] });

    const out = check("src/desk/desk.workflow.ts");

    expect(out).toContain("desk 0.1.0");
    // #116 / #141 AC6: the generated workflow is a flow — workflow start → main router ⇄ agents → finish
    expect(out).toContain("text (workflow start) → main");
    expect(out).toContain("main → triage | answerer | text (workflow finish)");
    expect(out).toContain("triage, answerer → main");
    expect(out).toContain("limits    run 9 steps (default) · $0.1 · day $2");
    // create wires the MCP server and the knowledge base into the first agent
    expect(out).toMatch(
      /triage .*\n\s+Sorts requests\n\s+limits: .*\n\s+rag: desk_notes \(tool, k 3\)/,
    );
    expect(out).toContain("· search_orders (local)");
    expect(out).toContain("· read_desk_files (MCP desk_files)");
    // #107 AC2: files named by kind, the prompt next to its agent (no prompt parameter)
    for (const file of [
      "agents/answerer.agent.ts",
      "agents/answerer.prompt.md",
      "tools/search-orders.tool.ts",
      "tools/search-orders.tool.test.ts",
      "mcp/desk-files.server.ts",
      "mcp/read-desk-files.mcp.ts",
      "rag/desk-notes.rag.ts",
      "workflow-starts/text.workflow-start.ts",
      "workflow-finishes/text.workflow-finish.ts",
    ]) {
      expect(existsSync(join(project, "src/desk", file)), file).toBe(true);
    }
    // #141 AC6: the start and the finish of a new workflow are TextWorkflowStart / TextWorkflowFinish
    const desk = (file: string): string => readFileSync(join(project, "src/desk", file), "utf8");
    expect(desk("workflow-starts/text.workflow-start.ts")).toContain(
      "export class TextWorkflowStart {\n  declare readonly input: WorkflowStartText;\n}",
    );
    expect(desk("workflow-finishes/text.workflow-finish.ts")).toContain(
      "export class TextWorkflowFinish {}",
    );
    // #142: the main router of a new workflow is on the star's cycle, so it declares maxVisits
    expect(desk("routers/main.router.ts")).toContain("maxVisits: 3,");
    expect(readFileSync(join(project, "src/desk/agents/answerer.agent.ts"), "utf8")).not.toContain(
      "prompt:",
    );
    expect(scripts().chat).toBe("agboss chat --workflow src/desk/desk.workflow.ts");
    // #135 AC12: the workflow test on testWith runs offline in the unit project; empty projects pass
    const unit = vitestOf(project, ["--project", "unit"]);
    expect(unit.ok, unit.out).toBe(true);
    expect(unit.out).toContain("desk.workflow.test.ts");
    expect(vitestOf(project, ["--project", "integration"]).ok).toBe(true);
    expect(vitestOf(project, ["--project", "suites"]).ok).toBe(true);
    expect(scripts().test).toBe("vitest run --project unit --project integration");
  }, 240_000);

  it("AC2: generate agent, router, tool, mcp, rag and workflow — each wired, the project still compiles and passes", async () => {
    const workflow = "src/desk/desk.workflow.ts";
    const steps = [
      planGenerate("agent", "billing", { workflow, description: "Handles invoices" }, project),
    ];
    await applyChanges(project, await (steps[0] ?? { create: [], modify: [] }));
    for (const plan of [
      () => planGenerate("tool", "refund", { workflow, agent: "billing" }, project),
      () =>
        planGenerate(
          "mcp",
          "tickets",
          { workflow, command: "tickets-mcp", tool: "search", agent: "billing" },
          project,
        ),
      () =>
        planGenerate(
          "rag",
          "policies",
          { workflow, folder: "policies", agent: "billing" },
          project,
        ),
      () => planGenerate("router", "escalation", { workflow }, project),
      () => planGenerate("workflow", "onboarding", {}, project),
    ]) {
      await applyChanges(project, await plan());
    }

    const out = check(workflow);

    expect(out).toMatch(/billing .*\n\s+Handles invoices/);
    // #116: a new agent joins the star — a route in the main router and both transitions
    expect(out).toContain("main → triage | answerer | billing | text (workflow finish)");
    expect(out).toContain("triage, answerer, billing → main");
    expect(readFileSync(join(project, "src/desk/routers/main.router.ts"), "utf8")).toContain(
      '{ prompt: "Handles invoices", target: BillingAgent }',
    );
    // #142 AC3: `agboss g router` writes maxVisits: 1, and the workflow still assembles (check above)
    expect(readFileSync(join(project, "src/desk/routers/escalation.router.ts"), "utf8")).toContain(
      "maxVisits: 1,",
    );
    expect(out).toContain("rag: policies (tool, k 3)");
    expect(out).toContain("· refund (local)");
    expect(out).toContain("· tickets_search (MCP tickets)");
    // #141 AC3: a text-only MCP server tool replies with PlainText
    expect(readFileSync(join(project, "src/desk/mcp/tickets.server.ts"), "utf8")).toContain(
      "output: PlainText",
    );
    expect(check("src/onboarding/onboarding.workflow.ts")).toContain("onboarding 0.1.0");
    expect(scripts()["chat:onboarding"]).toBeDefined();
  }, 240_000);

  it("AC2: rerunning generators with --force regenerates files and doubles no wiring", async () => {
    const workflow = "src/desk/desk.workflow.ts";
    const read = (path: string): string => readFileSync(join(project, path), "utf8");
    const before = [workflow, "src/desk/routers/main.router.ts"].map(read);

    for (const [kind, name, options] of [
      ["agent", "billing", { workflow, description: "Handles invoices, again" }],
      ["tool", "refund", { workflow, agent: "billing" }],
      ["rag", "policies", { workflow, folder: "policies", agent: "billing" }],
    ] as const) {
      const plan = await planGenerate(kind, name, options, project);
      await expect(applyChanges(project, plan)).rejects.toThrow("Nothing was written");
      await applyChanges(project, plan, { force: true });
    }

    expect([workflow, "src/desk/routers/main.router.ts"].map(read)).toEqual(before);
    expect(read("src/desk/routers/main.router.ts")).toContain(FINISH_ROUTE_TEXT);
    check(workflow);
  }, 240_000);
});

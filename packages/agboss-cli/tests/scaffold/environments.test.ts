/**
 * #239: `agboss create` puts the environments where the runtime looks — next to the workflow file — and
 * injects `ENV` for real (the tools' `ApiService`); `agboss check` fails exactly when the start would.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { specFromFlags } from "../../src/scaffold/flags.js";
import type { WorkflowSpec } from "../../src/scaffold/plan.js";
import { planProject } from "../../src/scaffold/project.js";
import { applyChanges } from "../../src/scaffold/write.js";
import { expectStaticChecks, agbossIn, vitestOf } from "./project-checks.js";

const tmp = new URL("../../.scaffold-tmp", import.meta.url).pathname;
const project = join(tmp, `shop-${String(process.pid)}`);
const workflow = "src/shop/shop.workflow.ts";
const environments = join(project, "src/shop/environments");
const read = (path: string): string => readFileSync(join(project, path), "utf8");
const MISSING =
  /^\[di\.missing-environment\] ApiService injects ENV, but the app has no environment/;

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
});

describe("#239: environments next to the workflow file, ENV injected for real", () => {
  it("AC1: a fresh project — its ApiService (deps: [ENV]) starts with the app and its test passes", async () => {
    mkdirSync(tmp, { recursive: true });
    const spec = specFromFlags("shop", {
      yes: true,
      agents: "clerk:Answers about orders",
      tools: "clerk:find_order",
    }) as WorkflowSpec;
    await applyChanges(project, { create: planProject(spec), modify: [] });

    for (const file of ["environment.ts", "dev.environment.ts", "staging.environment.ts"])
      expect(existsSync(join(environments, file)), file).toBe(true);
    expect(existsSync(join(project, "src/environments"))).toBe(false);
    expect(read("src/shop/services/api.service.ts")).toContain("@Injectable({ deps: [ENV] })");
    expect(read("src/shop/tools/find-order.tool.ts")).toContain("deps: [ApiService]");
    expectStaticChecks(project, ["src"]);
    const tests = vitestOf(project);
    expect(tests.ok, tests.out).toBe(true);
    expect(tests.out).toContain("api.service.test.ts");
    expect(tests.out).toContain("shop.workflow.test.ts");
    const check = agbossIn(project, ["check", "--workflow", workflow]);
    expect(check.out).toBe(`ok: ${workflow} — assembly, environment, prompts\n`);
    const described = agbossIn(project, ["describe", "--workflow", workflow]);
    expect(described.out).toContain("environment dev");
    expect(described.out).toContain('apiUrl = "https://api.example.com"');
    expect(described.out).toContain("· find_order (local) ← ApiService (ENV)");
  }, 240_000);

  it("AC2: the environments moved away → agboss check fails with [di.missing-environment], as the app's start", () => {
    renameSync(environments, `${environments}-moved`);
    try {
      const check = agbossIn(project, ["check", "--workflow", workflow, "--json"]);
      expect(check.status, check.out).toBe(3);
      const { result } = JSON.parse(check.stdout) as {
        result: { problems: { code: string; message: string }[] };
      };
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]?.code).toBe("di.missing-environment");
      expect(result.problems[0]?.message).toMatch(MISSING);
      // the app's start (testWith builds the app as createApp does) fails the same way
      const tests = vitestOf(project, ["--project", "unit"]);
      expect(tests.ok).toBe(false);
      expect(tests.out).toContain(
        "[di.missing-environment] ApiService injects ENV, but the app has no environment",
      );
    } finally {
      renameSync(`${environments}-moved`, environments);
    }
    expect(agbossIn(project, ["check", "--workflow", workflow]).ok).toBe(true);
  }, 120_000);
});

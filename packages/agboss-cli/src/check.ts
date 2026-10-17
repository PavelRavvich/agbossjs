import { type AssembledWorkflow } from "agboss";
import {
  flagOption,
  loadOptions,
  textOption,
  workflowPath,
  type CommandHandler,
} from "./cli/context.js";
import { environmentProblems } from "./cli/check-environment.js";
import { modelProblemsOf } from "./cli/check-models.js";
import { envOption } from "./cli/environment.js";
import { assemble, modelProblem, problemText, type CheckProblem } from "./cli/check-problems.js";
import { CliError } from "./cli/errors.js";
import { checkFlow } from "./cli/flow-types.js";

/** What a check gets: the assembled workflow and where it came from. */
export interface CheckTarget {
  readonly file: string;
  readonly bundle: AssembledWorkflow;
  readonly env: NodeJS.ProcessEnv;
  /** `--env <name>`; undefined = the default. */
  readonly envName: string | undefined;
}

/** A named check of `agboss check`; none needs an API key. */
export interface WorkflowCheck {
  readonly name: string;
  /** Set = runs only with this flag (it needs the network); unset = runs on every `agboss check`. */
  readonly flag?: string;
  readonly run: (target: CheckTarget) => Promise<readonly CheckProblem[]>;
}

/**
 * Every check after assembly (assembly itself — loading, graph rules, DI, config — always runs first).
 * Adding a check is one line here.
 */
export const CHECKS: readonly WorkflowCheck[] = [
  { name: "environment", run: environmentProblems },
  {
    // assembly reads and checks every prompt (#199): its problems are reported as prompt.* by
    // assemble(); a workflow that assembled has none left
    name: "prompts",
    run: () => Promise.resolve([]),
  },
  {
    name: "models",
    flag: "models",
    run: async ({ file, bundle, env }) =>
      (await modelProblemsOf(bundle, env)).map((problem) => modelProblem(file, problem)),
  },
];

/** `agboss check --workflow <path> [--models] [--profile <p>] [--env <name>] [--json]` — no API key needed. */
export const handle: CommandHandler = async (context) => {
  const file = workflowPath(context);
  // v2 workflows (#272): analysed, and .agboss/types.d.ts written before the report
  const flow = await checkFlow(context, file);
  if (flow !== undefined) return flow;
  const selected = CHECKS.filter(
    (check) => check.flag === undefined || flagOption(context.values, check.flag),
  );
  const assembly = await assemble(file, textOption(context.values, "profile"), {
    cwd: context.io.cwd,
    ...loadOptions(context),
  });
  const problems: CheckProblem[] = [];
  if (assembly.kind === "failed") problems.push(...assembly.problems);
  else
    for (const check of selected)
      problems.push(
        ...(await check.run({
          file,
          bundle: assembly.bundle,
          env: context.io.env,
          envName: envOption(context),
        })),
      );
  const checks = ["assembly", ...selected.map((check) => check.name)];
  problems.forEach((problem) => {
    context.say(problemText(problem));
  });
  if (problems.length === 0) context.say(`ok: ${file} — ${checks.join(", ")}`);
  const result = { workflow: file, checks, problems };
  if (problems.length === 0) return { result };
  const failure = new CliError(
    "project",
    "check.failed",
    `${String(problems.length)} problem(s) in ${file}`,
  );
  return { result, failure };
};

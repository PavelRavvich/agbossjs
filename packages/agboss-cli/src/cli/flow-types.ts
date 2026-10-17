import { relative, resolve } from "node:path";
import { WorkflowLoadError } from "agboss";
import { FlowTypesStatus, writeFlowTypes, type FlowTypesResult } from "agboss/internal";
import { problemText, type CheckProblem } from "./check-problems.js";
import { loadOptions, type CommandContext, type CommandOutcome } from "./context.js";
import { CliError } from "./errors.js";

/**
 * Type generation in the CLI (#272 S2, S7): `agboss check` on a module with v2 workflows analyses
 * them and writes `.agboss/types.d.ts` before it reports; `agboss generate` regenerates the file at
 * its end. A module without a v2 workflow (the old DSL until #272 PR 4) goes the old way, untouched.
 */

/** The generator's result for one module; undefined when it holds no v2 workflow or is missing. */
async function generate(
  context: CommandContext,
  file: string,
): Promise<FlowTypesResult | undefined> {
  try {
    const result = await writeFlowTypes({
      files: [resolve(context.io.cwd, file)],
      project: context.io.cwd,
      ...loadOptions(context),
    });
    return result.status === FlowTypesStatus.NoFlow ? undefined : result;
  } catch (error) {
    // a missing module is reported by the old path as workflow.load, with its own message
    if (error instanceof WorkflowLoadError) return undefined;
    throw error;
  }
}

const problemsOf = (file: string, result: FlowTypesResult): readonly CheckProblem[] =>
  result.errors.map((found) => ({ file, code: found.code, message: found.message }));

/** `agboss check` of a module with v2 workflows; undefined for the old DSL. */
export async function checkFlow(
  context: CommandContext,
  file: string,
): Promise<CommandOutcome | undefined> {
  const result = await generate(context, file);
  if (result === undefined) return undefined;
  const problems = problemsOf(file, result);
  const warnings = result.warnings.map((found) => problemText({ file, ...found }));
  const types = relative(context.io.cwd, result.outFile);
  [...problems.map(problemText), ...warnings, ...result.notes].forEach((line) => {
    context.say(line);
  });
  const isWritten = result.status === FlowTypesStatus.Written;
  if (isWritten) context.say(`types: ${types}`);
  if (problems.length === 0) context.say(`ok: ${file} — flow, types`);
  const outcome = {
    result: {
      workflow: file,
      checks: ["flow", "types"],
      problems,
      ...(isWritten ? { types } : {}),
    },
    warnings: [...warnings, ...result.notes],
  };
  if (problems.length === 0) return outcome;
  const message = `${String(problems.length)} problem(s) in ${file}`;
  return { ...outcome, failure: new CliError("project", "check.failed", message) };
}

/** The end of `agboss generate`: regenerates the types of the workflow it changed, if v2. */
export async function regenerateFlowTypes(
  context: CommandContext,
  changed: readonly string[],
): Promise<void> {
  const workflow = changed.find((path) => path.endsWith(".workflow.ts"));
  if (workflow === undefined) return;
  const result = await generate(context, workflow).catch((error: unknown) => {
    // generate never validated the workflow: a module that does not load is reported, not fatal
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    context.warn(
      `types not regenerated: ${reason ?? ""} — run agboss check --workflow ${workflow}`,
    );
    return undefined;
  });
  if (result === undefined) return;
  if (result.status === FlowTypesStatus.Written)
    context.say(`  types: ${relative(context.io.cwd, result.outFile)}`);
  else
    problemsOf(workflow, result).forEach((problem) => {
      context.warn(problemText(problem));
    });
}

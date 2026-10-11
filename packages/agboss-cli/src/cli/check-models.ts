import { type AssembledWorkflow } from "agboss";
import {
  checkModelUses,
  directoryOf,
  modelSummaryOf,
  modelUsesOf,
  problemLine,
  type ProviderFetch,
} from "agboss/internal";
import type { ModelProblem } from "agboss/models";

/** What `agboss check --models` prints and the exit code it ends with. */
export interface ModelCheckReport {
  readonly lines: readonly string[];
  readonly exitCode: 0 | 1;
}

/** Every model setting that does not fit its model, as its provider lists it (no API key). */
export async function modelProblemsOf(
  bundle: AssembledWorkflow,
  env: NodeJS.ProcessEnv,
  send?: ProviderFetch,
): Promise<readonly ModelProblem[]> {
  const directory = directoryOf(bundle.models);
  return checkModelUses(modelUsesOf(bundle.config, bundle.routers), directory, {
    env,
    ...(send === undefined ? {} : { send }),
  });
}

/**
 * `agboss check --models`: every model setting of the workflow against what its provider says the model
 * supports — all problems at once, exit code 1 when there is any. Needs no API key.
 */
export async function checkWorkflowModels(
  bundle: AssembledWorkflow,
  env: NodeJS.ProcessEnv,
  send?: ProviderFetch,
): Promise<ModelCheckReport> {
  const directory = directoryOf(bundle.models);
  const uses = modelUsesOf(bundle.config, bundle.routers);
  const problems = await modelProblemsOf(bundle, env, send);
  if (problems.length === 0) {
    return {
      lines: [
        ...modelSummaryOf(uses, directory),
        `ok: ${String(uses.length)} model settings fit their models`,
      ],
      exitCode: 0,
    };
  }
  return {
    lines: [
      `ConfigurationError: ${String(problems.length)} model setting(s) do not fit their models`,
      ...problems.map((problem) => `  ${problemLine(problem)}`),
    ],
    exitCode: 1,
  };
}

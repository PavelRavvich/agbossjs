import { ComponentError, EnvironmentError, type AssembledWorkflow } from "agboss";
import { createStartComponents, describeServices, environmentFor } from "agboss/internal";
import { resolve } from "node:path";
import type { CheckProblem } from "./check-problems.js";

/** What the environment check reads: the workflow, the `--env` name and the process env. */
export interface EnvironmentTarget {
  readonly file: string;
  readonly bundle: AssembledWorkflow;
  readonly envName: string | undefined;
  readonly env: NodeJS.ProcessEnv;
}

/** `[di.missing-environment] …` → its code; another component error is the app's start failing. */
const componentCode = (error: ComponentError): string =>
  /^\[([a-z][\w.-]*)\]/.exec(error.message)?.[1] ?? "workflow.start";

const problemOf = (file: string, error: unknown): CheckProblem[] => {
  if (error instanceof EnvironmentError)
    return [{ file, code: error.code, message: error.message }];
  if (error instanceof ComponentError)
    return [{ file, code: componentCode(error), message: error.message }];
  throw error;
};

/**
 * `agboss check` without running anything: the selected environment is found, every `fromEnv` variable it
 * needs is set, and every component the app's start creates (tools, observers, judges, channels, …)
 * gets its dependencies — with no environment, none of them injects `ENV` (#239).
 */
export async function environmentProblems(target: EnvironmentTarget): Promise<CheckProblem[]> {
  try {
    const environment = await environmentFor(
      resolve(target.file),
      { env: target.envName },
      target.env,
    );
    const { router } = describeServices;
    createStartComponents(target.bundle, {
      router,
      ...(environment === undefined ? {} : { environment }),
    });
    return [];
  } catch (error) {
    return problemOf(target.file, error);
  }
}

import { createAppDeps, loadWorkflow, type AppDeps, withProfile } from "agboss";
import { loadOptions, workflowPath, type CommandContext } from "../cli/context.js";
import { cliEnvironment } from "../cli/environment.js";

/** The app parts of the workflow with a profile (eval, replay, golden and compare use them). */
export async function depsFor(
  context: CommandContext,
  profile: string | undefined,
): Promise<AppDeps> {
  const file = workflowPath(context);
  const bundle = await loadWorkflow(file, loadOptions(context));
  const environment = await cliEnvironment(context, file);
  const deps = await createAppDeps(await withProfile(bundle, profile, context.io.cwd), {
    processEnv: context.io.env,
    ...(environment === undefined ? {} : { environment }),
  });
  deps.warnings.forEach((warning) => {
    context.warn(`warning: ${warning}`);
  });
  return deps;
}

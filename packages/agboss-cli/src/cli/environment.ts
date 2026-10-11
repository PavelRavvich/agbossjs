import { type Environment } from "agboss";
import { environmentFor } from "agboss/internal";
import { resolve } from "node:path";
import { textOption, type CommandContext } from "./context.js";

/** `--env <name>`; undefined = the default (`dev`, when the workflow has an `environments/` folder). */
export const envOption = (context: CommandContext): string | undefined =>
  textOption(context.values, "env");

/** The environment of the workflow file a command works on, resolved against the CLI's process env. */
export const cliEnvironment = (
  context: CommandContext,
  workflowFile: string,
): Promise<Environment | undefined> =>
  environmentFor(resolve(workflowFile), { env: envOption(context) }, context.io.env);

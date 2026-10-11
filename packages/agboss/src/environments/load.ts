import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Class } from "../components/injection.js";
import { isEnvironmentDefinition, type Environment, type EnvironmentDefinition } from "./define.js";
import {
  describedEnvironment,
  EnvironmentError,
  resolveEnvironment,
  type DescribedEnvironment,
} from "./resolve.js";

/** The environments tried in order when none is named (Angular's development default). */
export const APP_DEFAULT_ENVIRONMENTS = ["dev"] as const;
/** Tests prefer `test.environment.ts` and fall back to `dev`. */
export const TEST_DEFAULT_ENVIRONMENTS = ["test", "dev"] as const;

const FILE = /^(.+)\.environment\.(ts|mts|js|mjs)$/;

/** Each `@Workflow` class's file: its `environments/` folder is next to it. */
const workflowFiles = new WeakMap<Class, string>();

export const rememberWorkflowFile = (workflow: Class, file: string | undefined): void => {
  if (file !== undefined) workflowFiles.set(workflow, file);
};

export const workflowFileOf = (workflow: Class): string | undefined => workflowFiles.get(workflow);

/** `environments/` next to the workflow file. */
const environmentsDirOf = (workflowFile: string): string =>
  join(dirname(workflowFile), "environments");

/** The environment names of a folder (`dev`, `staging`, …), sorted; none when there is no folder. */
function availableEnvironments(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir).flatMap((file) => {
    const name = FILE.exec(file)?.[1];
    return name === undefined || name.endsWith(".d") ? [] : [name];
  });
  return [...new Set(names)].sort();
}

const fileOf = (dir: string, name: string): string | undefined =>
  ["ts", "mts", "js", "mjs"]
    .map((ext) => join(dir, `${name}.environment.${ext}`))
    .find((file) => existsSync(file));

/** The `export default defineEnvironment({ … })` of `<dir>/<name>.environment.ts`. */
async function loadEnvironmentDefinition(
  dir: string,
  name: string,
): Promise<EnvironmentDefinition> {
  const file = fileOf(dir, name);
  if (file === undefined) {
    const available = availableEnvironments(dir);
    throw new EnvironmentError(
      "environment.not-found",
      `Environment "${name}" not found: ${join(dir, `${name}.environment.ts`)}. Available: ${available.length === 0 ? "none" : available.join(", ")}`,
    );
  }
  const module = (await import(pathToFileURL(file).href)) as { default?: unknown };
  if (!isEnvironmentDefinition(module.default)) {
    throw new EnvironmentError(
      "environment.not-found",
      `${file} must \`export default defineEnvironment({ … })\``,
    );
  }
  return module.default;
}

/** Which environment an app runs with: one given as values, or one named (default `dev`). */
export interface EnvironmentSelection {
  /** The name of `environments/<env>.environment.ts` next to the workflow file. */
  readonly env?: string | undefined;
  /** The values themselves (tests): no file is read. */
  readonly environment?: Environment | undefined;
}

/** Names tried in order when `env` is not given; the first with a file wins, else the first name. */
type Defaults = readonly string[];

const defaultName = (dir: string, defaults: Defaults): string =>
  defaults.find((name) => fileOf(dir, name) !== undefined) ?? defaults[0] ?? "dev";

/** The folder and name to load; none = the app has no environment (no name, no folder). */
function selected(
  workflowFile: string | undefined,
  env: string | undefined,
  defaults: Defaults = APP_DEFAULT_ENVIRONMENTS,
): { readonly dir: string; readonly name: string } | undefined {
  const dir = workflowFile === undefined ? undefined : environmentsDirOf(workflowFile);
  if (env === undefined && (dir === undefined || !existsSync(dir))) return undefined;
  const name = env ?? (dir === undefined ? (defaults[0] ?? "dev") : defaultName(dir, defaults));
  if (dir === undefined) {
    throw new EnvironmentError(
      "environment.not-found",
      `Environment "${name}" not found: the workflow's file is unknown`,
    );
  }
  return { dir, name };
}

/**
 * The app's environment: the values given, else the named file resolved against `processEnv`. With no
 * name and no `environments/` folder the app has none (a service injecting `ENV` then fails at start).
 */
export async function environmentFor(
  workflowFile: string | undefined,
  selection: EnvironmentSelection,
  processEnv: NodeJS.ProcessEnv,
  defaults: Defaults = APP_DEFAULT_ENVIRONMENTS,
): Promise<Environment | undefined> {
  if (selection.environment !== undefined) return selection.environment;
  const target = selected(workflowFile, selection.env, defaults);
  if (target === undefined) return undefined;
  const definition = await loadEnvironmentDefinition(target.dir, target.name);
  return resolveEnvironment(target.name, definition, processEnv);
}

/** The environment for `agboss describe`: like `environmentFor`, but a missing variable is shown, not fatal. */
export async function describedEnvironmentFor(
  workflowFile: string,
  env: string | undefined,
  processEnv: NodeJS.ProcessEnv,
): Promise<DescribedEnvironment | undefined> {
  const target = selected(workflowFile, env);
  if (target === undefined) return undefined;
  const definition = await loadEnvironmentDefinition(target.dir, target.name);
  return describedEnvironment(target.name, definition, processEnv);
}

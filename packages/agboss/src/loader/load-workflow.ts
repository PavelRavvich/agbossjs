import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { componentOf, workflowOf, type Class } from "../components/index.js";
import type { AssembledWorkflow } from "../workflow.js";

import { WorkflowLoadError } from "./load-errors.js";

export { WorkflowLoadError } from "./load-errors.js";

let tsxRegistered = false;

/** Workflows are TypeScript with decorators: Node's type stripping cannot run them, tsx can. */
async function registerTypeScript(): Promise<void> {
  if (tsxRegistered) return;
  const { register } = await import("tsx/esm/api");
  register();
  tsxRegistered = true;
}

const isWorkflowClass = (value: unknown): value is Class =>
  typeof value === "function" && componentOf(value)?.kind === "workflow";

/** The one exported `@Workflow` class of a module file (`--workflow ./src/x.workflow.ts`). */
export async function loadWorkflowClass(
  path: string,
  options: { readonly typescript?: boolean } = {},
): Promise<Class> {
  const file = resolve(path);
  if (!existsSync(file)) throw new WorkflowLoadError(`Workflow file not found: ${file}`);
  if (options.typescript !== false) await registerTypeScript();
  const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  const found = Object.values(module).filter(isWorkflowClass);
  const [workflow] = found;
  if (found.length !== 1 || workflow === undefined) {
    throw new WorkflowLoadError(
      `${file}: expected exactly one exported @Workflow class, found ${String(found.length)}`,
    );
  }
  return workflow;
}

/** Loads and assembles the workflow of a module file. */
export const loadWorkflow = async (
  path: string,
  options: { readonly typescript?: boolean } = {},
): Promise<AssembledWorkflow> => workflowOf(await loadWorkflowClass(path, options));

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Class } from "../components/injection.js";
import { walkFlow } from "../flow/analyse/walk.js";
import type { LoadedModule } from "../flow/analyse/rules/context.js";
import { NodeKind } from "../flow/ast.js";
import { declarationOf } from "../flow/decorators/declaration.js";
import { WorkflowLoadError } from "./load-errors.js";
import { importedModules, registerTypeScript } from "./typescript.js";

/**
 * Loads the v2 workflows of module files (#272 S2) and the project modules they were loaded from:
 * every module tsx loaded (the import record), plus the workflow files and the files the components
 * were declared in — where TypeScript was compiled beforehand (tests), the record is empty and these
 * are the modules known.
 */

/** The v2 workflows of the loaded files and the project modules with their named exports. */
export interface FlowProject {
  readonly workflows: readonly Class[];
  readonly modules: readonly LoadedModule[];
}

export interface FlowLoadOptions {
  /** false where TypeScript is already compiled (tests); tsx is registered by default. */
  readonly typescript?: boolean;
}

const isFlowWorkflow = (value: unknown): value is Class =>
  typeof value === "function" && declarationOf(value as Class)?.kind === NodeKind.Workflow;

const namespaceOf = async (file: string): Promise<Readonly<Record<string, unknown>>> =>
  (await import(pathToFileURL(file).href)) as Readonly<Record<string, unknown>>;

/** The files the components of the workflows were declared in. */
function componentFiles(workflows: readonly Class[]): readonly string[] {
  return workflows.flatMap((workflow) => {
    const declaration = declarationOf(workflow);
    if (declaration?.kind !== NodeKind.Workflow) return [];
    const { nodes } = walkFlow(declaration.options.flow).graph;
    return [...nodes.values()].flatMap((node) =>
      node.declaration.source === undefined ? [] : [node.declaration.source],
    );
  });
}

export async function loadFlowProject(
  paths: readonly string[],
  options: FlowLoadOptions = {},
): Promise<FlowProject> {
  if (options.typescript !== false) await registerTypeScript();
  const files = paths.map((path) => resolve(path));
  const workflows: Class[] = [];
  for (const file of files) {
    if (!existsSync(file)) throw new WorkflowLoadError(`Workflow file not found: ${file}`);
    workflows.push(...Object.values(await namespaceOf(file)).filter(isFlowWorkflow));
  }
  const known = new Set([...importedModules(), ...files, ...componentFiles(workflows)]);
  const modules: LoadedModule[] = [];
  for (const file of [...known].sort()) modules.push({ file, exports: await namespaceOf(file) });
  return { workflows, modules };
}

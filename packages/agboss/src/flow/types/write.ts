import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RuleViolation } from "../../graph/rule-error.js";
import { loadFlowProject } from "../../loader/load-flow.js";
import { GENERATED_TYPES_FILE, generateFlowTypes } from "./generate.js";

/**
 * `agboss check`, the end of `agboss generate` and the repo's `check:types` step (#272 S7): load the
 * workflow modules (tsx, transpile-only — S2), generate, write `<project>/.agboss/types.d.ts`. A
 * module without a v2 workflow is left alone (the old DSL until #272 PR 4).
 */

export enum FlowTypesStatus {
  /** The modules hold no v2 workflow: nothing generated. */
  NoFlow = "no-flow",
  /** The file was written. */
  Written = "written",
  /** Generation failed (`[types.unexported-class]`, a name clash): the file was not written. */
  Failed = "failed",
}

/** What to generate the types of, and where. */
export interface FlowTypesWrite {
  /** The workflow modules. */
  readonly files: readonly string[];
  /** The project directory; the file goes to `<project>/.agboss/types.d.ts`. */
  readonly project: string;
  /** false where TypeScript is already compiled (tests); tsx is registered by default. */
  readonly typescript?: boolean;
  /** The module the tables are augmented in: `agboss` by default, a file's path in this repo. */
  readonly tablesModule?: string;
  /** `--strict`: analyser warnings are errors. */
  readonly strict?: boolean;
}

/** What generation did and found. */
export interface FlowTypesResult {
  /** Whether the file was written. */
  readonly status: FlowTypesStatus;
  /** `<project>/.agboss/types.d.ts`. */
  readonly outFile: string;
  /** The workflows' rule violations and generation's own (`[types.unexported-class]`, clashes). */
  readonly errors: readonly RuleViolation[];
  /** The analyser's warnings (`[flow.path-too-deep]`). */
  readonly warnings: readonly RuleViolation[];
  /** S4 lines: the nodes whose `InputOf` is flat. */
  readonly notes: readonly string[];
}

/** Loads the modules, generates the types and writes them (unless generation failed). */
export async function writeFlowTypes(request: FlowTypesWrite): Promise<FlowTypesResult> {
  const outFile = join(request.project, GENERATED_TYPES_FILE);
  const typescript = request.typescript === undefined ? {} : { typescript: request.typescript };
  const { workflows, modules } = await loadFlowProject(request.files, typescript);
  if (workflows.length === 0)
    return { status: FlowTypesStatus.NoFlow, outFile, errors: [], warnings: [], notes: [] };
  const generated = generateFlowTypes({
    workflows,
    modules,
    outFile,
    ...(request.tablesModule === undefined ? {} : { tablesModule: request.tablesModule }),
    ...(request.strict === undefined ? {} : { strict: request.strict }),
  });
  const { errors, warnings, notes, text } = generated;
  if (text === undefined)
    return { status: FlowTypesStatus.Failed, outFile, errors, warnings, notes };
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, text);
  return { status: FlowTypesStatus.Written, outFile, errors, warnings, notes };
}

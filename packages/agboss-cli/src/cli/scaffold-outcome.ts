import type { CommandContext, CommandOutcome } from "./context.js";
import { apply, skippedOf, type ApplyOptions, type Changes } from "../scaffold/write.js";

const pathsOf = (files: Changes["create"]): string[] => files.map((file) => file.path);

/** `--dry-run`: what would be written (the plan, with contents under --json), nothing written. */
export function dryRun(context: CommandContext, plan: Changes, what: string): CommandOutcome {
  context.say(`Dry run: would write ${what}`);
  [...pathsOf(plan.create), ...pathsOf(plan.modify)].forEach((path) => {
    context.say(`  ${path}`);
  });
  const skipped = skippedOf(plan);
  skipped.forEach((line) => {
    context.say(`  skipped: ${line}`);
  });
  return { result: { dryRun: true, plan }, warnings: skipped };
}

/**
 * Writes the plan under `root` (all or nothing) and reports created / modified files; with `--force`,
 * wiring left out because it is already there and wiring kept in regenerated files are warnings.
 */
export async function write(
  root: string,
  plan: Changes,
  result: Record<string, unknown> = {},
  options: ApplyOptions = {},
): Promise<CommandOutcome> {
  const applied = await apply(root, plan, options);
  return {
    result: { ...result, written: [...applied.created, ...applied.modified] },
    created: applied.created,
    modified: applied.modified,
    warnings: [
      ...applied.skipped.map((line) => `skipped: ${line}`),
      ...applied.kept.map((line) => `kept: ${line}`),
    ],
  };
}

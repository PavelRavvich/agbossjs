import type { UsageRecord } from "../../finops/usage.js";
import { GuardFailedError } from "../../graph/errors.js";
import { checkGuard, type Guard } from "../../guards/index.js";
import { GuardrailBlockedError } from "./errors.js";
import { sortedJson } from "./json.js";

/**
 * The workflow's guards on an execution's input (at its start) or output (at its finish): run in
 * order on the value's text — its `text` field when it has one, else its JSON. The first that trips
 * fails the execution with `GuardrailBlockedError` (#120: a guard hit is not a status); a guard that
 * cannot decide fails closed (`GuardFailedError`).
 */

/** The text a guard reads of a value. */
export const guardTextOf = (value: unknown): string =>
  typeof value === "object" && value !== null && "text" in value && typeof value.text === "string"
    ? value.text
    : sortedJson(value);

/** Runs the guards; their spend when every one passes. */
export async function runGuards(
  guards: readonly Guard[],
  value: unknown,
): Promise<readonly UsageRecord[]> {
  const text = guardTextOf(value);
  const usage: UsageRecord[] = [];
  for (const guard of guards) {
    const verdict = await checkGuard(guard, text);
    if (verdict.usage !== undefined) usage.push(verdict.usage);
    if (verdict.kind === "failed") throw new GuardFailedError(guard.name, usage, verdict.reason);
    if (verdict.kind === "tripped")
      throw new GuardrailBlockedError(guard.name, guard.refusal, usage);
  }
  return usage;
}
